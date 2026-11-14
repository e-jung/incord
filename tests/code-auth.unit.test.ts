import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {OAuthStorageDO} from '../cloudflare/oauth-storage';
import worker, { RegistryDO, UserDO, signInCodeKey, emailKey, authIpBucket, type Env } from '../cloudflare/worker';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()});
function state(id:string) { const db=new DatabaseSync(':memory:'); return {id:{toString:()=>id},storage:{sql:{exec(q:string,...args:any[]){const stmt=db.prepare(q);return stmt.columns().length?stmt.all(...args):(stmt.run(...args),[])}},transactionSync:(fn:()=>unknown)=>fn()},blockConcurrencyWhile:(fn:()=>unknown)=>fn()} as unknown as DurableObjectState }
function fixture(){
 const env={SESSION_SECRET:'email-unit-only-secret-more-than-32-chars',EMAIL_TEST_SINK:'1'} as Env;
 const registryState=state('registry'),registry=new RegistryDO(registryState),users=new Map<string,UserDO>();
 env.REGISTRY={idFromName:(id:string)=>id,get:()=>({fetch:(url:string,init:RequestInit)=>registry.fetch(new Request(url,init))})} as unknown as DurableObjectNamespace;
 env.USERS={idFromName:(id:string)=>id,get:(id:string)=>({fetch:(url:string,init:RequestInit)=>{if(!users.has(id))users.set(id,new UserDO(state(id),env));return users.get(id)!.fetch(new Request(url,init))}})} as unknown as DurableObjectNamespace;
 const oauth=new OAuthStorageDO(state('oauth'));env.OAUTH_STORAGE={idFromName:(id:string)=>id,get:()=>({fetch:(url:string,init:RequestInit)=>oauth.fetch(new Request(url,init))})} as unknown as DurableObjectNamespace;
 const call=(path:string,data?:unknown,cookie='',ip='192.0.2.1',host='localhost')=>worker.fetch(new Request('http://'+host+path,{method:data===undefined?'GET':'POST',headers:{Origin:'http://'+host,'Content-Type':'application/json',Cookie:cookie,'CF-Connecting-IP':ip},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
 const code=async(email:string)=>(await (await call('/api/test/last-code?email='+encodeURIComponent(email))).json<any>()).code as string;
 const start=(email:string,link=false,cookie='')=>call('/api/auth/email/start',{email,link},cookie);
 const verify=async(email:string,value?:string,link=false,cookie='')=>call('/api/auth/email/verify',{email,code:value??await code(email),link},cookie);
 const login=async(email:string)=>{await start(email);const res=await verify(email);return {body:await res.json<any>(),cookie:res.headers.get('Set-Cookie')!.split(';')[0]}};
 const internal=async(path:string,data:unknown)=>(await registry.fetch(new Request('http://internal'+path,{method:'POST',body:JSON.stringify(data)}))).json<any>();
 return {env,call,code,start,verify,login,internal,registryState,users};
}
import { CODE_WORDS, generateSignInCode, normalizeCode, validCode, SIGN_IN_CODE_ENTROPY_BITS } from '../shared/sign-in-code';
describe('Code-only accounts',()=>{
 const create=async(f:ReturnType<typeof fixture>,ip='192.0.2.1')=>{const response=await f.call('/api/auth/code/create',{},'',ip);expect(response.status).toBe(200);return {body:await response.json<any>(),cookie:response.headers.get('Set-Cookie')!.split(';')[0]}};
 it('canonicalizes auth IP buckets, grouping IPv6 /64 and preserving IPv4 hosts',()=>{
  for(const ip of ['2001:db8:abcd:1234::1','2001:0DB8:ABCD:1234:ffff:eeee:dddd:cccc','2001:db8:abcd:1234:0:0:0:2'])expect(authIpBucket(ip)).toBe('2001:0db8:abcd:1234::/64');
  expect(authIpBucket('2001:db8:abcd:1235::1')).not.toBe(authIpBucket('2001:db8:abcd:1234::1'));
  expect(authIpBucket('::1')).toBe('0000:0000:0000:0000::/64');
  expect(authIpBucket('2001:db8::192.0.2.1')).toBe('2001:0db8:0000:0000::/64');
  for(const ip of ['192.0.2.1','::ffff:192.0.2.1','0:0:0:0:0:FFFF:C000:0201'])expect(authIpBucket(ip)).toBe('192.0.2.1');
  expect(authIpBucket('192.0.2.2')).toBe('192.0.2.2');
  for(const ip of [null,'','invalid','2001:db8:::1','::ffff:999.0.2.1','2001:db8::1%eth0','[::1]'])expect(authIpBucket(ip)).toBe('local');
 });
 it('shares both code and general auth limits across rotating IPv6 addresses in one /64',async()=>{
  const f=fixture();
  for(let i=0;i<10;i++)expect((await f.call('/api/auth/code/signin',{code:'invalid'},'','2001:db8:1234:5678::'+i)).status).toBe(401);
  const denied=await f.call('/api/auth/code/create',{},'','2001:db8:1234:5678:ffff:eeee:dddd:cccc');expect(denied.status).toBe(429);
  await create(f,'2001:db8:1234:5679::1');
  for(let i=0;i<60;i++)expect((await f.call('/api/auth/logout',{},'','2001:db8:1:2::'+i.toString(16))).status).toBe(200);
  expect((await f.call('/api/auth/logout',{},'','2001:db8:1:2:ffff:ffff:ffff:ffff')).status).toBe(429);
  expect((await f.call('/api/auth/logout',{},'','2001:db8:1:3::1')).status).toBe(200);
 });
 it('bounds global creation at 1000/15min without capping regeneration or spending failed-signin budget',async()=>{
  const f=fixture(),account=await create(f),sql=f.registryState.storage.sql;
  sql.exec("UPDATE limits SET count=999 WHERE id='code-global-create'");
  await create(f,'192.0.2.2');expect([...sql.exec("SELECT count FROM limits WHERE id='code-global-create'")][0].count).toBe(1000);
  const denied=await f.call('/api/auth/code/create',{},'','192.0.2.3');expect(denied.status).toBe(429);expect((await denied.json<any>()).error).toBe('Unable to sign in with that code. Check it or try again later.');
  expect([...sql.exec('SELECT uid FROM accounts')]).toHaveLength(2);
  expect([...sql.exec("SELECT * FROM limits WHERE id='code-global-failed'")]).toEqual([]);
  expect((await f.call('/api/auth/code/regenerate',{},account.cookie)).status).toBe(200);
  expect((await f.call('/api/auth/code/signin',{code:'invalid'},'','192.0.2.4')).status).toBe(401);
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+900001);await create(f,'192.0.2.3');expect([...sql.exec("SELECT count FROM limits WHERE id='code-global-create'")][0].count).toBe(1);
 });
 it('reuses the exact 2048 unique compound words and gives 46.28 unbiased bits',()=>{
  // Prefix-free words keep all three-word combinations distinct after hyphens are removed.
  expect(CODE_WORDS.some(word=>CODE_WORDS.some(other=>other!==word&&other.startsWith(word)))).toBe(false);
  expect(CODE_WORDS).toHaveLength(2048);expect(new Set(CODE_WORDS).size).toBe(2048);expect(CODE_WORDS[0]).toBe('amberacorn');expect(CODE_WORDS.at(-1)).toBe('violetrose');expect(SIGN_IN_CODE_ENTROPY_BITS).toBeGreaterThan(46.28);
  const random=vi.spyOn(crypto,'getRandomValues');random.mockImplementationOnce((a:any)=>{a.set([0,2048+1,2047,4294960000]);return a}).mockImplementationOnce((a:any)=>{a[0]=4294967295;return a}).mockImplementationOnce((a:any)=>{a[0]=42;return a});
  expect(generateSignInCode()).toBe('amberacorn-amberapple-violetrose-0042');expect(random).toHaveBeenCalledTimes(3);
 });
 it('normalizes whitespace, hyphens and case, including fully concatenated input; rejects other words and punctuation',()=>{
  const code='amberacorn-amberapple-violetrose-0042';expect(normalizeCode(' AMBERACORN - amberapple\n violetrose - 0042 ')).toBe(code.replaceAll('-',''));
  for(const value of [code,code.replaceAll('-',''),code.toUpperCase(),code.replaceAll('-',' ')])expect(validCode(value)).toBe(true);
  for(const value of [null,42,'',code+'1',code.replace('0042','042'),code.replace('amberacorn','naughtyword'),code.replaceAll('-','_'),'x'.repeat(1000)])expect(validCode(value)).toBe(false);
 });
 it('creates and restores a code-only identity with HMAC-only SQL storage and non-secret revision',async()=>{
  const f=fixture(),account=await create(f),{code,user}=account.body;
  expect(validCode(code)).toBe(true);expect(user).toMatchObject({hasCode:true,hasEmail:false,hasGoogle:false,codeRevision:expect.any(String)});
  const key=await signInCodeKey(f.env,code);expect(key).not.toBe(user.codeRevision);expect(await signInCodeKey(f.env,code.toUpperCase().replaceAll('-',''))).toBe(key);expect(await signInCodeKey({...f.env,SESSION_SECRET:'different'},code)).not.toBe(key);
  expect([...f.registryState.storage.sql.exec('SELECT * FROM mapping')]).toEqual([{kind:'code',id:key,uid:user.id}]);
  const dump=JSON.stringify(['mapping','code_revisions','accounts','limits','challenges'].flatMap(table=>[...f.registryState.storage.sql.exec('SELECT * FROM '+table)]));expect(dump).not.toContain(code);expect(dump).not.toContain(normalizeCode(code));
  const login=await f.call('/api/auth/code/signin',{code:code.toUpperCase().replaceAll('-','')});expect(login.status).toBe(200);expect((await login.json<any>()).user.id).toBe(user.id);
  const me=await(await f.call('/api/me',undefined,account.cookie)).json<any>();expect(me.user.codeRevision).toBe(user.codeRevision);expect(JSON.stringify(me)).not.toContain(key);expect(me.code).toBeUndefined();
  expect((await f.call('/api/auth/code/create',{},account.cookie)).status).toBe(409);
 });
 it('rotates atomically, immediately invalidates the old code and cache revision, and protects code-only removal',async()=>{
  const f=fixture(),account=await create(f);expect((await f.call('/api/auth/code/regenerate',{})).status).toBe(401);expect((await f.call('/api/auth/code/remove',{},account.cookie)).status).toBe(409);
  const rotated=await f.call('/api/auth/code/regenerate',{},account.cookie);expect(rotated.status).toBe(200);const next=await rotated.json<any>();expect(next.user.id).toBe(account.body.user.id);expect(next.user.codeRevision).not.toBe(account.body.user.codeRevision);
  expect((await f.call('/api/auth/code/signin',{code:account.body.code})).status).toBe(401);expect((await f.call('/api/auth/code/signin',{code:next.code})).status).toBe(200);
  expect([...f.registryState.storage.sql.exec("SELECT * FROM mapping WHERE kind='code'")]).toHaveLength(1);
 });
 it('never steals a colliding code mapping or resurrects a claimed account',async()=>{
  const f=fixture(),a=await create(f),b=await create(f),sql=f.registryState.storage.sql;
  expect(await f.internal('/code/set',{uid:a.body.user.id,key:await signInCodeKey(f.env,b.body.code),revision:'replacement'})).toEqual({ok:false});
  expect((await f.call('/api/auth/code/signin',{code:a.body.code})).status).toBe(200);expect((await f.call('/api/auth/code/signin',{code:b.body.code})).status).toBe(200);
  expect((await f.internal('/identity',{uid:a.body.user.id})).codeRevision).toBe(a.body.user.codeRevision);
  const uid='11111111-1111-4111-8111-111111111111';await f.internal('/schedule/set',{uid});await f.internal('/maintenance/claim',{uid});expect(await f.internal('/code/set',{uid,key:'new-key',revision:'rev'})).toMatchObject({error:'Account no longer exists'});
  expect([...sql.exec("SELECT * FROM mapping WHERE uid=?",uid)]).toEqual([]);
 });
 it('rejects an explicit Google sub collision even without authoritative email',async()=>{
  const f=fixture(),a=await create(f),b=await create(f);
  expect(await f.internal('/google',{uid:a.body.user.id,sub:'existing-sub'})).toEqual({uid:a.body.user.id});
  expect(await f.internal('/google',{uid:b.body.user.id,sub:'existing-sub'})).toMatchObject({error:'That Google account already belongs to another account.'});
  expect(await f.internal('/google',{sub:'existing-sub'})).toEqual({uid:a.body.user.id});
 });
 it('preserves UID through email linking, then permits removal without losing email access',async()=>{
  const f=fixture(),account=await create(f);await f.start('linked@example.com',true,account.cookie);const linked=await f.verify('linked@example.com',undefined,true,account.cookie);expect((await linked.json<any>()).user.id).toBe(account.body.user.id);
  const response=await f.call('/api/auth/code/remove',{},account.cookie);expect(response.status).toBe(200);expect((await response.json<any>()).user).toMatchObject({hasCode:false,hasEmail:true,codeRevision:null});expect((await f.call('/api/auth/code/signin',{code:account.body.code})).status).toBe(401);expect((await f.login('linked@example.com')).body.user.id).toBe(account.body.user.id);
 });
 it('excludes code accounts from orphan selection and serialized deletion claims',async()=>{
  const f=fixture(),account=await create(f);expect(await f.internal('/maintenance/orphans',{limit:100})).toMatchObject({orphanAccounts:0,users:[]});expect(await f.internal('/maintenance/claim',{uid:account.body.user.id})).toEqual({claimed:false});
  await f.internal('/schedule/set',{uid:'11111111-1111-4111-8111-111111111111'});expect(await f.internal('/maintenance/orphans',{limit:100})).toMatchObject({orphanAccounts:1});expect(await f.internal('/maintenance/claim',{uid:'11111111-1111-4111-8111-111111111111'})).toEqual({claimed:true});
 });
 it('limits creation and sign-in together to ten per IP per 15 minutes; independent IP and expiry work',async()=>{
  const f=fixture();for(let i=0;i<5;i++){await create(f);expect((await f.call('/api/auth/code/signin',{code:'invalid'})).status).toBe(401)}
  const rejected=await f.call('/api/auth/code/create',{});expect(rejected.status).toBe(429);const invalid=await f.call('/api/auth/code/signin',{code:'invalid'});expect(invalid.status).toBe(429);expect((await invalid.json<any>()).error).toBe((await rejected.json<any>()).error);await create(f,'192.0.2.2');
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+900001);await create(f);
 });
 it('charges only failures to the global 10,000/15min budget and rejects distributed failures at the boundary',async()=>{
  const f=fixture(),account=await create(f),sql=f.registryState.storage.sql;
  expect((await f.call('/api/auth/code/signin',{code:account.body.code})).status).toBe(200);expect([...sql.exec("SELECT * FROM limits WHERE id='code-global-failed'")]).toEqual([]);
  sql.exec('INSERT INTO limits VALUES(?,?,?)','code-global-failed',9999,Date.now()+900000);
  expect((await f.call('/api/auth/code/signin',{code:'invalid'},'','192.0.2.2')).status).toBe(401);expect([...sql.exec("SELECT count FROM limits WHERE id='code-global-failed'")][0].count).toBe(10000);
  expect((await f.call('/api/auth/code/signin',{code:'invalid'},'','192.0.2.3')).status).toBe(429);
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+900001);expect((await f.call('/api/auth/code/signin',{code:account.body.code})).status).toBe(200);
 });
 it('binds explicit Google links to the signed-in UID, rejects collisions and checks session at callback',async()=>{
  const f=fixture(),account=await create(f),other=await f.login('other@gmail.com');f.env.GOOGLE_CLIENT_ID='id';f.env.GOOGLE_CLIENT_SECRET='secret';expect((await f.call('/api/auth/google?link=1')).status).toBe(401);
  const begin=async()=>{const response=await f.call('/api/auth/google?link=1',undefined,account.cookie);expect(response.status).toBe(302);return {target:new URL(response.headers.get('Location')!),flow:response.headers.get('Set-Cookie')!.split(';')[0]}};
  const profile={sub:'new-google',email:'new@gmail.com',email_verified:true};vi.stubGlobal('fetch',vi.fn(async(url)=>String(url).includes('/token')?Response.json({access_token:'token'}):Response.json(profile)));
  let flow=await begin();let callback=await f.call('/api/auth/google/callback?code=test&state='+flow.target.searchParams.get('state'),undefined,account.cookie+'; '+flow.flow);expect(callback.status).toBe(302);expect((await(await f.call('/api/me',undefined,callback.headers.get('Set-Cookie')!.split(';')[0])).json<any>()).user).toMatchObject({id:account.body.user.id,hasGoogle:true,hasCode:true});
  profile.sub='other-sub';profile.email='other@gmail.com';flow=await begin();callback=await f.call('/api/auth/google/callback?code=test&state='+flow.target.searchParams.get('state'),undefined,account.cookie+'; '+flow.flow);expect(callback.status).toBe(302);expect(callback.headers.get('Location')).toBe('/?googleLink=collision');expect((await f.login('other@gmail.com')).body.user.id).toBe(other.body.user.id);
  profile.email='unique@gmail.com';flow=await begin();callback=await f.call('/api/auth/google/callback?code=test&state='+flow.target.searchParams.get('state'),undefined,other.cookie+'; '+flow.flow);expect(callback.status).toBe(302);expect(callback.headers.get('Location')).toBe('/?googleLink=expired');
  profile.email='bad-email';flow=await begin();callback=await f.call('/api/auth/google/callback?code=test&state='+flow.target.searchParams.get('state'),undefined,account.cookie+'; '+flow.flow);expect(callback.status).toBe(302);expect(callback.headers.get('Location')).toBe('/?googleLink=failed');expect(callback.headers.get('Set-Cookie')).toContain('bh_flow=;');
  profile.email='unique@gmail.com';
  flow=await begin();await f.call('/api/auth/logout-everywhere',{},account.cookie);callback=await f.call('/api/auth/google/callback?code=test&state='+flow.target.searchParams.get('state'),undefined,account.cookie+'; '+flow.flow);expect(callback.status).toBe(302);expect(callback.headers.get('Location')).toBe('/?googleLink=expired');
 });
 it('leaves plain Google signin known errors as JSON rather than link redirects',async()=>{
  const f=fixture();f.env.GOOGLE_CLIENT_ID='id';f.env.GOOGLE_CLIENT_SECRET='secret';
  const begin=await f.call('/api/auth/google'),target=new URL(begin.headers.get('Location')!),flow=begin.headers.get('Set-Cookie')!.split(';')[0];
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({}, {status:401})));
  const response=await f.call('/api/auth/google/callback?code=test&state='+target.searchParams.get('state'),undefined,flow);expect(response.status).toBe(401);expect(response.headers.get('Location')).toBeNull();expect(await response.json()).toMatchObject({error:'Google sign-in failed'});
 });
});
