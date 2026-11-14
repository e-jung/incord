import { fakeAccounts } from './accounts-fixture';
import { accountsCall, accountsReturnPath, accountsError } from '../cloudflare/accounts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {OAuthStorageDO} from '../cloudflare/oauth-storage';
import worker, { RegistryDO, UserDO, b64, emailKey, type Env } from '../cloudflare/worker';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers()});
function state(id:string) { const db=new DatabaseSync(':memory:'); return {id:{toString:()=>id},storage:{sql:{exec(q:string,...args:any[]){const stmt=db.prepare(q);return stmt.columns().length?stmt.all(...args):(stmt.run(...args),[])}},deleteAll:async()=>{for(const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]) db.exec('DROP TABLE '+row.name)},transactionSync:(fn:()=>unknown)=>fn()},blockConcurrencyWhile:(fn:()=>unknown)=>fn()} as unknown as DurableObjectState }
function fixture(){
 const env={SESSION_SECRET:'email-unit-only-secret-more-than-32-chars',EMAIL_TEST_SINK:'1'} as Env;
 const fake=fakeAccounts();env.ACCOUNTS_SVC=fake.service;
 const registryState=state('registry'),registry=new RegistryDO(registryState),users=new Map<string,UserDO>();
 env.REGISTRY={idFromName:(id:string)=>id,get:()=>({fetch:(url:string,init:RequestInit)=>registry.fetch(new Request(url,init))})} as unknown as DurableObjectNamespace;
 env.USERS={idFromName:(id:string)=>id,get:(id:string)=>({fetch:(url:string,init:RequestInit)=>{if(!users.has(id))users.set(id,new UserDO(state(id),env));return users.get(id)!.fetch(new Request(url,init))}})} as unknown as DurableObjectNamespace;
 const oauth=new OAuthStorageDO(state('oauth'));env.OAUTH_STORAGE={idFromName:(id:string)=>id,get:()=>({fetch:(url:string,init:RequestInit)=>oauth.fetch(new Request(url,init))})} as unknown as DurableObjectNamespace;
 const call=(path:string,data?:unknown,cookie='',ip='192.0.2.1',host='localhost')=>worker.fetch(new Request('http://'+host+path,{method:data===undefined?'GET':'POST',headers:{Origin:'http://'+host,'Content-Type':'application/json',Cookie:cookie,'CF-Connecting-IP':ip},...(data===undefined?{}:{body:JSON.stringify(data)})}),env);
 const code=async(_email:string)=>'123456';
 const start=(email:string,link=false,cookie='')=>call('/api/auth/email/start',{email,link},cookie);
 const verify=async(email:string,value?:string,link=false,cookie='')=>call('/api/auth/email/verify',{email,code:value??await code(email),link},cookie);
 const login=async(email:string)=>{await start(email);const res=await verify(email);return {body:await res.json<any>(),cookie:res.headers.get('Set-Cookie')!.split(';')[0]}};
 const internal=async(path:string,data:unknown)=>(await registry.fetch(new Request('http://internal'+path,{method:'POST',body:JSON.stringify(data)}))).json<any>();
 return {fake,env,call,code,start,verify,login,internal,registryState,users};
}
describe('Accounts v1 boundary and app-local identity',()=>{
 it.each([['invalid_email',400],['invalid_code',401],['expired',401],['invalid_grant',401],['invalid_identity',409],['temporarily_unavailable',503],['unknown',503]])('maps %s calmly', (error,status)=>{expect(accountsError({error:String(error)}).status).toBe(status);expect(accountsError({error:String(error)}).message).not.toContain('unknown')});
 it('maps RPC exceptions and missing binding to 503, preserves rate-limit retry',async()=>{const f=fixture();f.fake.service.startEmail.mockRejectedValue(new Error('private provider details'));const res=await f.start('a@example.com');expect(res.status).toBe(503);expect(JSON.stringify(await res.json())).not.toContain('private');await expect(accountsCall(undefined,'getUser',{sub:'jl1_test'})).rejects.toMatchObject({status:503});f.fake.service.startEmail.mockResolvedValue({error:'rate_limited',retryAfter:42} as any);const limited=await f.start('a@example.com');expect(limited.status).toBe(429);expect(limited.headers.get('Retry-After')).toBe('42');expect(await limited.json()).toMatchObject({retryAfter:42})});
 it('passes normalized email and trusted IP to RPC, returns ticket only in response and stores no address/code',async()=>{const f=fixture();await f.start(' Person@Example.com ');expect(f.fake.service.startEmail).toHaveBeenCalledWith({email:'person@example.com',ip:'192.0.2.1'});const account=await f.login('person@example.com');expect(account.body).toMatchObject({ssoTicket:'test-one-time-ticket',user:{hasEmail:true}});const dump=JSON.stringify(['mapping','challenges','email_codes','email_test'].flatMap(t=>[...f.registryState.storage.sql.exec('SELECT * FROM '+t)]));expect(dump).not.toContain('person@example.com');expect(dump).not.toContain('123456');expect(dump).not.toContain('ticket');expect((await f.call('/api/me',undefined,account.cookie)).status).toBe(200)});
 it('resolves jl before email, lazily links old fingerprints, and never steals in link mode',async()=>{const f=fixture(),uid=crypto.randomUUID(),other=crypto.randomUUID(),key=await emailKey(f.env,'old@example.com');f.registryState.storage.sql.exec('INSERT INTO mapping VALUES(?,?,?)','email',key,uid);expect(await f.internal('/jl/resolve',{sub:'jl1_old',emailKey:key})).toEqual({uid});expect(await f.internal('/jl/resolve',{sub:'jl1_old',emailKey:'another'})).toEqual({uid});expect(await f.internal('/jl/resolve',{sub:'jl1_old',uid:other})).toMatchObject({error:expect.stringContaining('already belongs')});expect(await f.internal('/jl/resolve',{sub:'jl1_new',uid:other,emailKey:key})).toMatchObject({error:expect.stringContaining('already belongs')});const fresh=await f.internal('/jl/resolve',{sub:'jl1_fresh'});expect(fresh.uid).not.toBe(uid);expect(await f.internal('/maintenance/claim',{uid:fresh.uid})).toEqual({claimed:false});expect(await f.internal('/maintenance/orphans',{limit:100})).toMatchObject({orphanAccounts:0})});
 it('blocks unknown shared identities until legacy Google backfill prevents split accounts',async()=>{
  const f=fixture();await f.internal('/google',{sub:'legacy-unfingerprinted'});
  await f.start('new@example.com');expect((await f.verify('new@example.com')).status).toBe(503);
  expect([...f.registryState.storage.sql.exec("SELECT * FROM mapping WHERE kind='jl'")]).toHaveLength(0);
  const old=[...f.registryState.storage.sql.exec("SELECT uid FROM mapping WHERE kind='google'")][0];
  await f.internal('/jl/resolve',{sub:'jl1_imported',uid:old.uid});
  expect((await f.login('new@example.com')).body.user).toMatchObject({hasEmail:true});
 });
 it('links code account keeping UID and permits code removal with a jl method',async()=>{const f=fixture(),res=await f.call('/api/auth/code/create',{}),data=await res.json<any>(),cookie=res.headers.get('Set-Cookie')!.split(';')[0];await f.start('added@example.com',true,cookie);const linked=await f.verify('added@example.com',undefined,true,cookie);expect((await linked.json<any>()).user.id).toBe(data.user.id);f.registryState.storage.sql.exec("DELETE FROM mapping WHERE kind='email'");expect((await f.call('/api/auth/code/remove',{},cookie)).status).toBe(200);expect((await f.login('added@example.com')).body.user.id).toBe(data.user.id)});
 it('exports Accounts user data and blocks local deletion until deleteLink succeeds',async()=>{const f=fixture(),account=await f.login('delete@example.com');const exported=await (await f.call('/api/export',undefined,account.cookie)).json<any>();expect(exported.jesklabsAccounts[0]).toMatchObject({email:'delete@example.com',clients:['incord']});f.fake.service.deleteLink.mockRejectedValueOnce(new Error('offline'));const del=()=>worker.fetch(new Request('http://localhost/api/account',{method:'DELETE',headers:{Origin:'http://localhost',Cookie:account.cookie}}),f.env);expect((await del()).status).toBe(503);expect((await f.call('/api/me',undefined,account.cookie)).status).toBe(200); // fixture deleteAll supplied below for actual deletion
 f.fake.service.deleteLink.mockResolvedValue({deleted:'link'});expect((await del()).status).toBe(200);expect(await f.internal('/jl/links',{uid:account.body.user.id})).toEqual({subs:[]});expect(f.fake.service.deleteLink).toHaveBeenCalledWith({sub:exported.jesklabsAccounts[0].sub});});
 it.each(['//evil.test','/\\evil.test','https://evil.test','/\nattack'])('rejects unsafe return %s',path=>expect(accountsReturnPath(path)).toBe('/'));
});

async function begin(f:ReturnType<typeof fixture>,query='prompt=none&return='+encodeURIComponent('/?oauth=continue&join=group')){
 const res=await f.call('/api/auth/jesklabs?'+query),target=new URL(res.headers.get('Location')!);return {res,target,cookie:res.headers.get('Set-Cookie')!.split(';')[0],state:target.searchParams.get('state')!};
}
const callback=(f:ReturnType<typeof fixture>,flow:Awaited<ReturnType<typeof begin>>,query='code=grant')=>f.call('/auth/jesklabs/callback?state='+flow.state+'&'+query,undefined,flow.cookie);
describe('PKCE, browser binding, SSO consent and host-only cookies',()=>{
 it('stores PKCE server-side and exchanges exact redirect/verifier; no app session until confirmation',async()=>{const f=fixture(),flow=await begin(f);expect(flow.target.origin).toBe('https://accounts.jesklabs.com');expect(flow.target.searchParams.get('code_challenge_method')).toBe('S256');expect(flow.cookie).not.toContain('verifier');const response=await callback(f,flow);expect(response.headers.get('Location')).toContain('jlConfirm=1');expect(response.headers.get('Location')).toContain('oauth=continue');expect(response.headers.get('Location')).toContain('join=group');expect(response.headers.get('Set-Cookie')).not.toContain('bh_session');const pending=response.headers.get('Set-Cookie')!.split(';')[0];expect(await(await f.call('/api/auth/jesklabs/pending',undefined,pending)).json()).toEqual({email:'p•••@example.com'});expect((await f.call('/api/auth/jesklabs/confirm',{})).status).toBe(401);const confirm=await f.call('/api/auth/jesklabs/confirm',{},pending);expect(confirm.status).toBe(200);expect(await confirm.json()).toMatchObject({user:{hasEmail:true},returnPath:'/?oauth=continue&join=group'});expect((await f.call('/api/auth/jesklabs/confirm',{},pending)).status).toBe(401);const input=f.fake.service.exchangeCode.mock.calls[0][0] as any;expect(input.redirectUri).toBe('http://localhost/auth/jesklabs/callback');const digest=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.codeVerifier))));expect(digest).toBe(flow.target.searchParams.get('code_challenge'));for(const res of [flow.res,response,confirm]){expect(res.headers.get('Set-Cookie')).not.toMatch(/Domain=/i);expect(res.headers.get('Set-Cookie')).toContain('Secure; SameSite=Lax; Path=/')}});
 it('rejects wrong state, replay and expired challenge without exchange',async()=>{const f=fixture(),flow=await begin(f);const bad=await f.call('/auth/jesklabs/callback?state=wrong&code=grant',undefined,flow.cookie);expect(bad.headers.get('Location')).toContain('jlOptions=1');expect(bad.headers.get('Location')).toContain('join=group');expect((await callback(f,flow)).headers.get('Location')).toContain('join=group');expect(f.fake.service.exchangeCode).not.toHaveBeenCalled();const expired=await begin(f);vi.spyOn(Date,'now').mockReturnValue(Date.now()+600001);const expiredResponse=await callback(f,expired);expect(expiredResponse.headers.get('Location')).toContain('jlOptions=1');expect(expiredResponse.headers.get('Location')).toContain('join=group');expect(f.fake.service.exchangeCode).not.toHaveBeenCalled()});
 it('preserves return on login_required and RPC errors; cancellation consumes pending',async()=>{const f=fixture();let flow=await begin(f);expect((await callback(f,flow,'error=login_required')).headers.get('Location')).toBe('/?oauth=continue&join=group&jlOptions=1');flow=await begin(f);f.fake.service.exchangeCode.mockRejectedValueOnce(new Error('secret'));const failed=await callback(f,flow);expect(failed.headers.get('Location')).toContain('join=group');expect(failed.headers.get('Location')).not.toContain('secret');flow=await begin(f);const res=await callback(f,flow),pending=res.headers.get('Set-Cookie')!.split(';')[0];expect((await f.call('/api/auth/jesklabs/cancel',{},pending)).status).toBe(200);expect((await f.call('/api/auth/jesklabs/confirm',{},pending)).status).toBe(401)});
 it('enforces origin on confirm/cancel, expires pending after five minutes',async()=>{const f=fixture(),flow=await begin(f),res=await callback(f,flow),pending=res.headers.get('Set-Cookie')!.split(';')[0];const cross=await worker.fetch(new Request('http://localhost/api/auth/jesklabs/confirm',{method:'POST',headers:{Origin:'https://evil.test',Cookie:pending,'Content-Type':'application/json'},body:'{}'}),f.env);expect(cross.status).toBe(403);vi.spyOn(Date,'now').mockReturnValue(Date.now()+300001);expect((await f.call('/api/auth/jesklabs/confirm',{},pending)).status).toBe(401)});
 it('direct Google via accounts works while public switch defaults off and callback is not swallowed by assets',async()=>{const f=fixture();expect(await(await f.call('/api/config')).json()).toMatchObject({accountsGoogle:false,googleEnabled:false});f.env.ACCOUNTS_GOOGLE='1';expect(await(await f.call('/api/config')).json()).toMatchObject({accountsGoogle:true,googleEnabled:true});f.env.ACCOUNTS_GOOGLE='0';const flow=await begin(f,'provider=google');expect(flow.target.searchParams.get('provider')).toBe('google');const res=await callback(f,flow);expect(res.headers.get('Location')).toBe('/?signedIn=1');expect(res.headers.get('Set-Cookie')).toContain('bh_session=');expect(res.headers.get('Set-Cookie')).not.toMatch(/Domain=/i);});
});
describe('Counts-only resumable Google import',()=>{
 it('is dry-run by default, bounded, idempotent, reports lazy emails and requires stats auth',async()=>{
  const f=fixture();f.env.STATS_TOKEN='stats-unit-secret-more-than-32-characters';
  f.env.STATS={idFromName:(s:string)=>s,get:()=>({fetch:async()=>new Response('ok')})} as unknown as DurableObjectNamespace;
  const request=(input:unknown,token=f.env.STATS_TOKEN)=>worker.fetch(new Request('http://localhost/stats/maintenance/accounts-import',{method:'POST',headers:{Origin:'http://localhost',Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(input)}),f.env);
  for(const sub of ['google-a','google-b'])await f.internal('/google',{sub});
  await f.internal('/jl/resolve',{sub:'jl1_email',emailKey:await emailKey(f.env,'linked@example.com')});
  const uid=crypto.randomUUID();f.registryState.storage.sql.exec('INSERT INTO mapping VALUES(?,?,?)','email','pending-key',uid);
  expect((await request({},'wrong')).status).toBe(401);
  expect(await(await request({})).json()).toEqual({google:2,imported:0,alreadyLinked:0,conflicts:0,errors:0,emailOnlyPendingLazy:1});expect(f.fake.service.importIdentity).not.toHaveBeenCalled();
  expect(await(await request({confirm:true,limit:1})).json()).toMatchObject({imported:1,alreadyLinked:0});
  expect(await(await request({confirm:true})).json()).toMatchObject({imported:1,alreadyLinked:1});
  expect(await(await request({confirm:true})).json()).toMatchObject({imported:0,alreadyLinked:2});expect(f.fake.service.importIdentity).toHaveBeenCalledTimes(2);
  for(const [input] of f.fake.service.importIdentity.mock.calls){expect(input.verifiedAt).toBeGreaterThan(0);expect(input.verifiedAt).toBeLessThanOrEqual(Date.now())}
 });
 it('rotates failed batches so conflicts cannot starve untouched Google mappings',async()=>{
  const f=fixture();f.env.STATS_TOKEN='stats-unit-secret-more-than-32-characters';f.env.STATS={idFromName:(s:string)=>s,get:()=>({fetch:async()=>new Response('ok')})} as unknown as DurableObjectNamespace;
  for(const sub of ['first-google','second-google','third-google'])await f.internal('/google',{sub});
  const request=()=>worker.fetch(new Request('http://localhost/stats/maintenance/accounts-import',{method:'POST',headers:{Origin:'http://localhost',Authorization:'Bearer '+f.env.STATS_TOKEN,'Content-Type':'application/json'},body:'{"confirm":true,"limit":1}'}),f.env);
  f.fake.service.importIdentity.mockResolvedValueOnce({error:'invalid_identity'} as any);
  expect(await(await request()).json()).toMatchObject({conflicts:1});
  expect(await(await request()).json()).toMatchObject({imported:1});
  expect(await(await request()).json()).toMatchObject({imported:1});
  expect(new Set(f.fake.service.importIdentity.mock.calls.map(([input])=>input.googleSub)).size).toBe(3);
 });
 it('counts conflicts and unavailable imports without exposing identities',async()=>{
  const f=fixture();f.env.STATS_TOKEN='stats-unit-secret-more-than-32-characters';f.env.STATS={idFromName:(s:string)=>s,get:()=>({fetch:async()=>new Response('ok')})} as unknown as DurableObjectNamespace;
  await f.internal('/google',{sub:'private-google-sub'});f.fake.service.importIdentity.mockResolvedValueOnce({error:'invalid_identity'} as any);
  const request=()=>worker.fetch(new Request('http://localhost/stats/maintenance/accounts-import',{method:'POST',headers:{Origin:'http://localhost',Authorization:'Bearer '+f.env.STATS_TOKEN,'Content-Type':'application/json'},body:'{"confirm":true}'}),f.env);
  const report=await(await request()).json();expect(report).toMatchObject({conflicts:1,errors:0});expect(JSON.stringify(report)).not.toContain('private-google-sub');f.fake.service.importIdentity.mockRejectedValueOnce(new Error('private'));expect(await(await request()).json()).toMatchObject({conflicts:0,errors:1});
 });
});
describe('Legacy compatibility and cookie invariants',()=>{
 it.each([false,true])('keeps legacy Google available and imports without blocking login (outage=%s)',async outage=>{
  const f=fixture();f.env.GOOGLE_CLIENT_ID='test-client';f.env.GOOGLE_CLIENT_SECRET='test-secret';
  if(outage)f.fake.service.importIdentity.mockRejectedValueOnce(new Error('offline'));
  vi.stubGlobal('fetch',vi.fn(async(url)=>String(url).includes('/token')?Response.json({access_token:'test-token'}):Response.json({sub:'legacy-google-sub',email:'legacy@gmail.com',email_verified:true})));
  const res=await f.call('/api/auth/google'),target=new URL(res.headers.get('Location')!),cookie=res.headers.get('Set-Cookie')!.split(';')[0];
  const done=await f.call('/api/auth/google/callback?code=legacy-grant&state='+target.searchParams.get('state'),undefined,cookie);
  expect(done.status).toBe(302);expect(done.headers.get('Set-Cookie')).toContain('bh_session=');expect(f.fake.service.importIdentity).toHaveBeenCalledWith({googleSub:'legacy-google-sub',verifiedAt:expect.any(Number)});
  const sql=f.registryState.storage.sql;expect([...sql.exec("SELECT * FROM mapping WHERE kind='jl'")]).toHaveLength(outage?0:1);
  for(const response of [res,done])expect(response.headers.get('Set-Cookie')).not.toMatch(/Domain=/i);
 });
 it('all session-producing and clearing auth routes use host-only cookies',async()=>{
  const f=fixture();const created=await f.call('/api/auth/code/create',{}),account=await created.clone().json<any>(),cookie=created.headers.get('Set-Cookie')!.split(';')[0];
  const responses=[created,await f.call('/api/auth/code/signin',{code:account.code}),await f.call('/api/auth/code/regenerate',{},cookie),await f.call('/api/auth/logout',{},cookie),await f.call('/api/auth/logout-everywhere',{},cookie)];
  const email=await f.login('cookies@example.com');responses.push(await f.call('/api/auth/code/regenerate',{},email.cookie));
  for(const response of responses){expect(response.status).toBe(200);expect(response.headers.get('Set-Cookie')).not.toMatch(/Domain=/i);expect(response.headers.get('Set-Cookie')).toContain('HttpOnly;');expect(response.headers.get('Set-Cookie')).toContain('SameSite=Lax; Path=/')}
 });
});
