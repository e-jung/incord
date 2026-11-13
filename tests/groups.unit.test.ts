import {afterEach,describe,it,expect,vi} from 'vitest';
import {AsyncLocalStorage} from 'node:async_hooks';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runMcpTool} from '../cloudflare/mcp-tools';
import {RegistryDO,UserDO,type Env,settingsRecord,b64} from '../cloudflare/worker';
import {GroupDO,handleGroups,getGroups,cleanupGroups,generateInviteCode,INVITE_ALPHABET,normalizeInviteCode,groupHash,equalHash,resolveGroupGoal,projectGroupMember,weeklyWindow,scheduleGroups,dispatchGroupReminders} from '../cloudflare/groups';
function state(){const db=new DatabaseSync(':memory:');let tail=Promise.resolve();return {id:{toString:()=>crypto.randomUUID()},storage:{sql:{exec(q:string,...args:any[]){const stmt=db.prepare(q);return stmt.columns().length?stmt.all(...args):(stmt.run(...args),[])}},deleteAll:async()=>{for(const row of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[])db.exec('DROP TABLE '+row.name)},transactionSync(fn:()=>any){db.exec('SAVEPOINT tx');try{const out=fn();db.exec('RELEASE tx');return out}catch(error){db.exec('ROLLBACK TO tx');db.exec('RELEASE tx');throw error}}},blockConcurrencyWhile(fn:()=>any){const out=tail.then(fn);tail=out.catch(()=>{});return out}} as unknown as DurableObjectState}
function fixture(){const env={} as Env;const users=new Map<string,UserDO>(),groups=new Map<string,GroupDO>();const registry=new RegistryDO(state(),env);const scope=new AsyncLocalStorage<any>(),invocations:any[]=[],pushBodies:any[]=[],root={calls:0},fault={install:false};const namespace=(get:(id:string)=>any,label='registry')=>({idFromName:(id:string)=>id,get:(id:string)=>({fetch:async(r:Request)=>{(scope.getStore()||root).calls++;if(new URL(r.url).pathname==='/groups/push')pushBodies.push(await r.clone().json());if(fault.install&&new URL(r.url).pathname==='/install')throw new Error('simulated installation failure');const invocation={name:label+':'+id,path:new URL(r.url).pathname,calls:0};invocations.push(invocation);return scope.run(invocation,()=>get(id).fetch(r))}})}) as unknown as DurableObjectNamespace;
 Object.assign(env,{SESSION_SECRET:'groups-unit-test-secret-over-32-characters',REGISTRY:namespace(()=>registry),GROUPS:namespace(id=>{if(!groups.has(id))groups.set(id,new GroupDO(state(),env));return groups.get(id)},'group'),USERS:namespace(id=>{if(!users.has(id))users.set(id,new UserDO(state(),env));return users.get(id)},'user'),ASSETS:{fetch:async(request:Request)=>{try{return new Response(await readFile(resolve('public',new URL(request.url).pathname.slice(1))))}catch{return new Response(null,{status:404})}}}});
 const callUser=async(uid:string,path:string,data:any={})=>{const response=await env.USERS.get(env.USERS.idFromName(uid)).fetch(new Request('https://internal'+path,{method:'POST',body:JSON.stringify(data)}));expect(response.ok).toBe(true);return response.json<any>()};
 const init=async(uid:string,settings:any={})=>{await callUser(uid,'/init',{name:uid});if(Object.keys(settings).length)await callUser(uid,'/sync',{settings:{updatedAt:1,...settings}})};
 const api=async(uid:string,path='',body:any={},method='POST',ip=uid)=>{const response=await handleGroups(new Request('https://incord.test/api/groups'+path,{method,headers:{'CF-Connecting-IP':ip}}),env,uid,body);return response.json<any>()};
 return {env,api,init,callUser,groups,registry,invocations,root,fault,pushBodies};
}
afterEach(()=>vi.restoreAllMocks());
const item=(id:string,extra:any={})=>({id,title:'John 3:16',text:'Private text',collection:'bible',translation:'BSB',updatedAt:1,...extra});
describe('Groups codes and catalog goals',()=>{
 it('uses the exact alphabet, unbiased rejection, 16 characters and case/hyphen normalization',()=>{expect(INVITE_ALPHABET).toBe('abcdefghjkmnpqrstuvwxyz23456789');const n=INVITE_ALPHABET.length;vi.spyOn(crypto,'getRandomValues').mockImplementation((array:any)=>{array.fill(255);for(let i=0;i<16;i++)array[i]=i%n;return array});const code=generateInviteCode();expect(code).toBe(INVITE_ALPHABET.slice(0,16));expect(normalizeInviteCode(code.toUpperCase().match(/.{4}/g)!.join('-'))).toBe(code);expect(()=>normalizeInviteCode('o'.repeat(16))).toThrow()});
 it('hashes code indexes and compares differing lengths and content',async()=>{const hash=await groupHash('abcd');expect(hash).toHaveLength(64);expect(equalHash(hash,await groupHash('abcd'))).toBe(true);expect(equalHash(hash,hash+'a')).toBe(false);expect(equalHash(hash,await groupHash('abce'))).toBe(false)});
 it('validates only catalog IDs, ranges and metadata-only ESV goals',async()=>{const f=fixture();for(const selection of [{kind:'passage',id:'unknown',translation:'BSB'},{kind:'passage',id:'psalm-23',translation:'NIV'},{kind:'passage',id:'psalm-23',translation:'BSB',text:'custom'},{kind:'document',id:'wsc',translation:'BSB',start:0}])await expect(resolveGroupGoal(f.env,selection)).rejects.toThrow();const esv=await resolveGroupGoal(f.env,{kind:'passage',id:'psalm-23',translation:'ESV'});expect(esv.goal.itemIds).toEqual(['esv-psa-23-1--esv-psa-23-6']);expect(esv.items[0].text).toBe('');expect(JSON.stringify(esv.goal)).not.toContain('He makes me');const bsb=await resolveGroupGoal(f.env,{kind:'passage',id:'psalm-23',translation:'BSB'});expect(bsb.goal.itemIds).toEqual(['bsb-psa-23-1--bsb-psa-23-6']);const doc=await resolveGroupGoal(f.env,{kind:'document',id:'wsc',translation:'BSB',start:1,end:2});expect(doc.goal.itemIds).toEqual(['wsc-1','wsc-2']);const topic=await resolveGroupGoal(f.env,{kind:'topic',id:'topic-prayer',translation:'KJV'});expect(topic.goal.total).toBe(7);expect(topic.goal.itemIds.every((id:string)=>id.startsWith('kjv-'))).toBe(true);const starter=await resolveGroupGoal(f.env,{kind:'starter',id:'gospel',translation:'WEB'});expect(starter.goal.total).toBe(10);expect(starter.goal.itemIds.every((id:string)=>id.startsWith('web-'))).toBe(true)});
});
describe('serialized Groups membership and authorization',()=>{
 it('creates the public shape and never exposes identities or library internals',async()=>{const f=fixture();await f.init('secret-owner',{name:'Grace'});const {group,invite}=await f.api('secret-owner','',{name:'Friends'});expect(group).toMatchObject({name:'Friends',role:'owner',memberCount:1,weeklyPush:true});expect(invite.code).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);expect(invite.url).toBe('/join/'+normalizeInviteCode(invite.code));expect(JSON.stringify(group)).not.toContain('secret-owner');expect(group.members[0].name).toBe('Grace')});
 it('serializes concurrent owner and total caps, including pending reservations',async()=>{const f=fixture();await f.init('owner');const creates=await Promise.allSettled(Array.from({length:5},(_,i)=>f.api('owner','',{name:'G'+i})));expect(creates.filter(r=>r.status==='fulfilled')).toHaveLength(3);await f.init('joiner');for(let i=0;i<6;i++){await f.init('host'+i);const c=await f.api('host'+i,'',{name:'Host',approveNewMembers:true});if(i<5)expect(await f.api('joiner','/join',{code:c.invite.code})).toMatchObject({pending:true});else await expect(f.api('joiner','/join',{code:c.invite.code})).rejects.toMatchObject({status:409})}});
 it('lists persisted pending requests with only safe summaries and frees the membership cap on withdrawal',async()=>{
  const f=fixture();await f.init('requester');const created=[];
  for(let i=0;i<6;i++){await f.init('host'+i);const c=await f.api('host'+i,'',{name:'Request '+i,approveNewMembers:true});created.push(c);if(i<5)await f.api('requester','/join',{code:c.invite.code})}
  await expect(f.api('requester','/join',{code:created[5].invite.code})).rejects.toMatchObject({status:409});
  const id=created[0].group.id;
  await f.api('host0','/'+id+'/goal',{selection:{kind:'passage',id:'psalm-23',translation:'BSB'}});
  await f.api('host0','/'+id+'/update',{name:'Renamed while pending'});
  // Reconstruct the canonical object from its durable SQLite storage, as after eviction/reload.
  const persisted=f.groups.get(id) as any;f.groups.set(id,new GroupDO(persisted.ctx,f.env));
  f.invocations.length=0;f.root.calls=0;
  const listed=await f.api('requester','',{},'GET');expect(listed.groups).toEqual([]);expect(listed.pending).toHaveLength(5);
  expect(listed.pending[0]).toEqual({id,name:'Renamed while pending',requestedAt:expect.any(Number)});
  for(const request of listed.pending)expect(Object.keys(request).sort()).toEqual(['id','name','requestedAt']);
  expect(f.root.calls).toBe(6);expect(f.invocations.some(i=>['/project','/groups/state','/view'].includes(i.path))).toBe(false);
  const mcp=await runMcpTool('get_groups',{}, {groups:()=>getGroups(f.env,'requester')} as any);expect(mcp).toEqual(listed);
  for(const secret of ['members','goal','host0','uid','revision','invite','Psalm 23'])expect(JSON.stringify(mcp)).not.toContain(secret);
  await expect(f.api('requester','/'+id,{},'GET')).rejects.toMatchObject({status:404});
  await expect(f.api('requester','/'+id+'/goal/add')).rejects.toMatchObject({status:404});
  await f.api('requester','/'+listed.pending[0].id+'/leave');
  expect((await f.api('requester','',{},'GET')).pending).toHaveLength(4);
  expect(await f.api('requester','/join',{code:created[5].invite.code})).toMatchObject({pending:true});
  expect((await getGroups(f.env,'requester')).pending.map(p=>p.id)).not.toContain(id);
 });
 it('checks canonical pending membership and revision without granting active group views',async()=>{
  const f=fixture();for(const uid of ['host','pending','outsider'])await f.init(uid);
  const c=await f.api('host','',{name:'Private',approveNewMembers:true}),id=c.group.id;await f.api('pending','/join',{code:c.invite.code});
  const index=JSON.parse([...(f.registry as any).sql.exec('SELECT value FROM groups_registry')][0].value);
  const internal=async(path:string,uid:string,revision=index.revision)=>{const response=await f.env.GROUPS!.get(f.env.GROUPS!.idFromName(id)).fetch(new Request('https://internal'+path,{method:'POST',body:JSON.stringify({uid,revision})}));return {status:response.status,body:await response.json<any>()}};
  expect((await internal('/pending-view','pending')).body).toEqual({id,name:'Private',requestedAt:expect.any(Number)});
  for(const uid of ['outsider','host'])expect((await internal('/pending-view',uid)).status).toBe(404);
  expect((await internal('/pending-view','pending',index.revision-1)).status).toBe(503);
  expect((await internal('/view','pending')).status).toBe(404);
  const member=(await getGroups(f.env,'host')).groups[0].pending[0];await f.api('host','/'+id+'/approve',{memberId:member.id});
  const approved=await getGroups(f.env,'pending');expect(approved.pending).toEqual([]);expect(approved.groups).toHaveLength(1);
  expect((await internal('/pending-view','pending',index.revision+1)).status).toBe(404);
  await f.api('pending','/'+id+'/leave');expect(await getGroups(f.env,'pending')).toEqual({groups:[],pending:[]});
 });
 it('enforces 30 members under concurrent joins',async()=>{const f=fixture();await f.init('owner');const c=await f.api('owner','',{name:'Capacity'});const invite=await f.api('owner','/'+c.group.id+'/invite',{maxUses:100});const out=await Promise.allSettled(Array.from({length:32},async(_,i)=>{await f.init('u'+i);return f.api('u'+i,'/join',{code:invite.code})}));expect(out.filter(r=>r.status==='fulfilled')).toHaveLength(29);expect((await getGroups(f.env,'owner')).groups[0].memberCount).toBe(30)});
 it('expires, consumes, revokes and regenerates invites without plaintext persistence',async()=>{const f=fixture();for(const u of ['owner','one','two'])await f.init(u);const c=await f.api('owner','',{name:'Invite'}),id=c.group.id;const invite=await f.api('owner','/'+id+'/invite',{expiresDays:1,maxUses:1});await expect(f.api('one','/join',{code:c.invite.code})).rejects.toMatchObject({status:404});await f.api('one','/join',{code:invite.code});await expect(f.api('two','/join',{code:invite.code})).rejects.toMatchObject({status:404});const next=await f.api('owner','/'+id+'/invite',{});await f.api('owner','/'+id+'/invite/revoke');await expect(f.api('two','/join',{code:next.code})).rejects.toMatchObject({status:404});const exp=await f.api('owner','/'+id+'/invite',{expiresDays:1});const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+86400001);await expect(f.api('two','/join',{code:exp.code})).rejects.toMatchObject({status:404})});
 it('limits malformed join attempts per account and per hashed IP',async()=>{const f=fixture();await f.init('u');for(let i=0;i<10;i++)await expect(f.api('u','/join',{code:'bad'})).rejects.toMatchObject({status:400});await expect(f.api('u','/join',{code:'bad'})).rejects.toMatchObject({status:429});for(let i=0;i<50;i++)await expect(f.api('ip'+i,'/join',{code:'bad'},'POST','shared')).rejects.toMatchObject({status:400});await expect(f.api('ip51','/join',{code:'bad'},'POST','shared')).rejects.toMatchObject({status:429})});
 it('supports approvals, admin boundaries, owner transfer and deletion',async()=>{const f=fixture();for(const u of ['owner','admin','member','pending','outsider'])await f.init(u);const c=await f.api('owner','',{name:'Managed',approveNewMembers:true}),id=c.group.id;for(const u of ['admin','member','pending'])await f.api(u,'/join',{code:c.invite.code});let view=(await getGroups(f.env,'owner')).groups[0];for(const m of view.pending.filter((m:any)=>m.name!=='pending'))await f.api('owner','/'+id+'/approve',{memberId:m.id});view=(await getGroups(f.env,'owner')).groups[0];const admin=view.members.find((m:any)=>m.name==='admin'),member=view.members.find((m:any)=>m.name==='member');await f.api('owner','/'+id+'/role',{memberId:admin.id,role:'admin'});await expect(f.api('outsider','/'+id,{},'GET')).rejects.toMatchObject({status:404});await expect(f.api('admin','/'+id+'/role',{memberId:member.id,role:'admin'})).rejects.toMatchObject({status:403});await expect(f.api('admin','/'+id+'/remove',{memberId:view.members[0].id})).rejects.toMatchObject({status:403});await f.api('admin','/'+id+'/approve',{memberId:view.pending[0].id});await f.api('admin','/'+id+'/remove',{memberId:member.id});expect((await getGroups(f.env,'member')).groups).toHaveLength(0);await expect(f.api('owner','/'+id+'/leave')).rejects.toMatchObject({status:409});await f.api('owner','/'+id+'/transfer',{memberId:admin.id});await f.api('owner','/'+id+'/leave');await f.api('admin','/'+id,{},'DELETE');await expect(f.api('pending','/join',{code:c.invite.code})).rejects.toMatchObject({status:404});expect((await getGroups(f.env,'pending')).groups).toHaveLength(0)});
 it('enforces transfer ownership quota and lets pending members withdraw their reservation',async()=>{const f=fixture();for(const u of ['owner','target','pending'])await f.init(u);for(let i=0;i<3;i++)await f.api('target','',{name:'Owned'});const c=await f.api('owner','',{name:'Transfer',approveNewMembers:true}),id=c.group.id;await f.api('target','/join',{code:c.invite.code});await f.api('pending','/join',{code:c.invite.code});let view=(await getGroups(f.env,'owner')).groups[0];const target=view.pending.find((m:any)=>m.name==='target');await f.api('owner','/'+id+'/approve',{memberId:target.id});await expect(f.api('owner','/'+id+'/transfer',{memberId:target.id})).rejects.toMatchObject({status:409});await f.api('pending','/'+id+'/leave');view=(await getGroups(f.env,'owner')).groups[0];expect(view.pending).toEqual([])});
 it('account cleanup deletes owned groups and drops active and pending membership',async()=>{const f=fixture();for(const u of ['owner','other'])await f.init(u);const c=await f.api('owner','',{name:'Deleted'});await f.api('other','/join',{code:c.invite.code});await cleanupGroups(f.env,'other');expect((await getGroups(f.env,'owner')).groups[0].memberCount).toBe(1);await cleanupGroups(f.env,'owner');expect((await getGroups(f.env,'owner')).groups).toEqual([]);await expect(f.api('other','/join',{code:c.invite.code})).rejects.toMatchObject({status:404});await cleanupGroups({} as Env,'legacy')});
});
describe('Groups SQLite architecture and bounded fanout',()=>{
 it('stores goals/rosters in GroupDO and only indexes in the registry; failed membership installs reserve quota and retry idempotently',async()=>{
  const f=fixture();for(const uid of ['owner','joiner'])await f.init(uid);
  const c=await f.api('owner','',{name:'Durable'}),id=c.group.id;
  await f.api('owner','/'+id+'/goal',{selection:{kind:'passage',id:'psalm-23',translation:'BSB'}});
  const sql=(f.groups.get(id) as any).ctx.storage.sql;expect(JSON.parse([...sql.exec('SELECT value FROM group_state')][0].value)).toMatchObject({name:'Durable',goal:{title:'Psalm 23'},members:[{role:'owner'}]});
  const index=JSON.parse([...(f.registry as any).sql.exec('SELECT value FROM groups_registry')][0].value);expect(index.goal).toBeUndefined();expect(index.name).toBeUndefined();expect(index.pendingGroup).toBeUndefined();expect(index.members).toHaveLength(1);
  const invite=await f.api('owner','/'+id+'/invite',{maxUses:1});f.fault.install=true;
  await expect(f.api('joiner','/join',{code:invite.code})).rejects.toThrow();
  const reservation=JSON.parse([...(f.registry as any).sql.exec('SELECT value FROM groups_registry')][0].value);expect(reservation.members).toHaveLength(2);expect(reservation.pendingGroup).toBeDefined();
  await expect(getGroups(f.env,'owner')).rejects.toThrow();f.fault.install=false;
  const retried=await f.api('joiner','/join',{code:invite.code});expect(retried.group.memberCount).toBe(2);
  expect(JSON.parse([...(f.registry as any).sql.exec('SELECT value FROM groups_registry')][0].value).pendingGroup).toBeUndefined();
  const target=retried.group.members.find((m:any)=>m.self);f.fault.install=true;
  await expect(f.api('owner','/'+id+'/remove',{memberId:target.id})).rejects.toThrow();expect((await getGroups(f.env,'joiner')).groups).toEqual([]);
  f.fault.install=false;expect((await getGroups(f.env,'owner')).groups[0].memberCount).toBe(1);
 });
 it('projects five full 30-member groups with six root calls and no invocation over 32, including Sunday cron',async()=>{
  const f=fixture(),ids=[];for(let i=0;i<5;i++){
   await f.init('host'+i,{remindersEnabled:true,timezone:'UTC'});const c=await f.api('host'+i,'',{name:'Full '+i});ids.push(c.group.id);
   const invite=await f.api('host'+i,'/'+c.group.id+'/invite',{maxUses:100});
   for(let j=0;j<29;j++){const uid=j===0?'reader':'member-'+i+'-'+j;await f.init(uid,{remindersEnabled:true,timezone:'UTC'});await f.api(uid,'/join',{code:invite.code})}
  }
  f.invocations.length=0;f.root.calls=0;const result=await getGroups(f.env,'reader');expect(result.groups).toHaveLength(5);expect(result.groups.every(g=>g.members.length===30)).toBe(true);expect(f.root.calls).toBe(6);expect(Math.max(...f.invocations.map(i=>i.calls))).toBe(30);
  f.invocations.length=0;f.root.calls=0;await scheduleGroups(f.env,new Date('2026-11-15T18:00:00Z'));expect(f.root.calls).toBe(2);expect(Math.max(...f.invocations.map(i=>i.calls))).toBe(32);for(const id of ids)expect([...(f.groups.get(id) as any).ctx.storage.sql.exec('SELECT id FROM deliveries')]).toHaveLength(30);
  f.invocations.length=0;f.root.calls=0;Object.assign(f.env,{VAPID_PUBLIC_KEY:'test',VAPID_PRIVATE_KEY:'test'});await dispatchGroupReminders(f.env,Array.from({length:200},()=> 'reader'));expect(f.root.calls).toBe(1);expect(Math.max(...f.invocations.map(i=>i.calls))).toBeLessThanOrEqual(30);
 },15000); // 150 SQLite-backed members plus cron fanout under coverage.
 it('bounds projection work even when pending requests exceed the active roster cap',async()=>{const f=fixture();await f.init('owner');const c=await f.api('owner','',{name:'Approvals',approveNewMembers:true});const invite=await f.api('owner','/'+c.group.id+'/invite',{maxUses:100});for(let i=0;i<35;i++){await f.init('pending'+i);await f.api('pending'+i,'/join',{code:invite.code})}f.invocations.length=0;const out=await getGroups(f.env,'owner');expect(out.groups[0].pending).toHaveLength(35);expect(out.groups[0].members).toHaveLength(1);expect(Math.max(...f.invocations.map(i=>i.calls))).toBeLessThanOrEqual(30)});
 it('splits large cron group lists into bounded branches',async()=>{const f=fixture();for(let i=0;i<45;i++){await f.init('owner'+i);await f.api('owner'+i,'',{name:'Fanout'})}f.invocations.length=0;await scheduleGroups(f.env,new Date('2026-11-15T18:00:00Z'));expect(Math.max(...f.invocations.map(i=>i.calls))).toBeLessThanOrEqual(20);expect(f.invocations.filter(i=>i.path==='/schedule')).toHaveLength(45)});
 it('summarizes practiced members, not practice days, and aggregate shared-goal progress without names',async()=>{
  const f=fixture(),now=new Date('2026-11-15T18:00:00Z');vi.spyOn(Date,'now').mockReturnValue(+now);for(const uid of ['owner','other','third'])await f.init(uid,{remindersEnabled:true,timezone:'UTC'});
  const c=await f.api('owner','',{name:'Encouragement'}),id=c.group.id;for(const uid of ['other','third'])await f.api(uid,'/join',{code:c.invite.code});
  await f.api('owner','/'+id+'/goal',{selection:{kind:'passage',id:'psalm-23',translation:'BSB'}});
  for(const uid of ['owner','other'])await f.callUser(uid,'/sync',{items:[item('bsb-psa-23-1--bsb-psa-23-6',{learned:true})],events:[{id:uid+'-1',at:'2026-11-14T18:00:00Z'},{id:uid+'-2',at:'2026-11-15T17:00:00Z'}]});
  await scheduleGroups(f.env,now);expect(f.pushBodies).toHaveLength(3);for(const push of f.pushBodies){expect(push.body).toContain('2 practiced · Psalm 23: 2 of 3 learned');expect(push.body).not.toMatch(/owner|other|third|4 practiced/)}
  await scheduleGroups(f.env,now);expect(f.pushBodies).toHaveLength(3);
 });
 it.each(['WEB','ESV'])('keeps WSC starter canonical and unlabelled when Bible translation is %s',async translation=>{const f=fixture();const {goal,items}=await resolveGroupGoal(f.env,{kind:'starter',id:'wsc-start',translation});expect(goal.itemIds).toEqual(Array.from({length:12},(_,i)=>'wsc-'+(i+1)));expect(items.every(i=>i.translation===''&&i.collection==='wsc')).toBe(true)});
});
describe('privacy, additions and encouragement',()=>{
 it.each([
  ['esv-jhn-3-16',undefined,'John 3:16','John 3:16'],
  ['custom','esv','John 3:16','John 3:16'],
  ['ESV-jhn-3-16',undefined,undefined,'ESV passage'],
  ['custom','esv','For God so loved the world','ESV passage'],
 ])('sanitizes ESV titles identified by id or lowercase label: %s/%s',(id,translation,reference,title)=>{
  const state={settings:{},items:[item(id!,{translation,reference,title:'For God so loved the world',text:'Quotation must stay private'})]};
  const member={uid:'owner',id:'public-member',role:'owner' as const,pending:false,requestedAt:1,weekly:true};
  const projected=projectGroupMember(state,member,'owner',null);
  expect(projected.titles).toEqual([{title,translation:'ESV',learned:false}]);
  expect(JSON.stringify(projected)).not.toMatch(/For God so loved the world|Quotation must stay private/);
 });
 it('reflects title privacy immediately in every projection and uses legacy aliases/defaults',async()=>{const f=fixture();await f.init('owner',{name:'Grace',goal:5});await f.callUser('owner','/sync',{items:[item('one',{learned:false}),item('two',{learned:true})],events:[{id:'private-log',at:new Date().toISOString(),grade:1,text:'private'}]});const c=await f.api('owner','',{name:'Privacy'});expect(c.group.members[0]).toMatchObject({name:'Grace',weeklyGoal:5,titles:[{learned:false},{learned:true}]});await f.callUser('owner','/sync',{settings:{groupShareTitles:false,updatedAt:2}});const out=await getGroups(f.env,'owner');expect(out.groups[0].members[0].titles).toBeUndefined();for(const secret of ['Private text','private-log','grade','uid','email'])expect(JSON.stringify(out)).not.toContain(secret);expect(()=>settingsRecord({updatedAt:1,groupShareTitles:'false'})).toThrow();expect(()=>settingsRecord({updatedAt:1,groupReceivePrayer:0})).toThrow()});
 it('adds canonical goals through the shared insert merge, preserving concurrent local progress and ESV caps',async()=>{const f=fixture();await f.init('owner');const c=await f.api('owner','',{name:'Goal'}),id=c.group.id;await f.api('owner','/'+id+'/goal',{selection:{kind:'passage',id:'psalm-23',translation:'BSB'}});const local=item('bsb-psa-23-1--bsb-psa-23-6',{title:'Offline edit',step:3,updatedAt:Date.now()-1000});const added=await f.api('owner','/'+id+'/goal/add');expect(added.results[0].status).toBe('added');expect((await f.callUser('owner','/sync')).items[0].origin).toBe('group');await f.callUser('owner','/sync',{items:[local]});await f.api('owner','/'+id+'/goal/add');expect((await f.callUser('owner','/sync')).items[0]).toEqual(local);const esv=item('esv-jhn-3-16',{translation:'ESV',reference:'John 3:16',esvVerseKeys:['jhn-3-16'],text:'forbidden'});await f.callUser('owner','/groups/add',{items:[esv]});expect((await f.callUser('owner','/sync')).items.find((i:any)=>i.id===esv.id).text).toBe('');const invalid=item('esv-jud-1-1--esv-jud-1-20',{translation:'ESV',reference:'Jude 1:1-20'});expect((await f.callUser('owner','/groups/add',{items:[invalid]})).results[0].status).toBe('invalid reference')});
 it('reserves prayer once per ordered pair/day and prevents self/nonmember prayers',async()=>{const f=fixture();await f.init('owner');await f.init('other',{groupReceivePrayer:false});const c=await f.api('owner','',{name:'Prayer'}),id=c.group.id;const joined=await f.api('other','/join',{code:c.invite.code}),target=joined.group.members.find((m:any)=>m.self).id;expect(await f.api('owner','/'+id+'/pray',{memberId:target})).toEqual({ok:true});expect(await f.api('owner','/'+id+'/pray',{memberId:target})).toEqual({ok:true,alreadySent:true});await expect(f.api('other','/'+id+'/pray',{memberId:target})).rejects.toThrow();await expect(f.api('owner','/'+id+'/pray',{memberId:'missing'})).rejects.toThrow();const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+86400000);expect(await f.api('owner','/'+id+'/pray',{memberId:target})).toEqual({ok:true})});
 it('deduplicates the same ordered pair across two groups, including concurrent requests',async()=>{
  const f=fixture();for(const uid of ['sender','recipient','third'])await f.init(uid);
  const groups=[];for(const name of ['First','Second']){const c=await f.api('sender','',{name});const joined=await f.api('recipient','/join',{code:c.invite.code});groups.push({id:c.group.id,target:joined.group.members.find((m:any)=>m.self).id,sender:c.group.members[0].id,code:c.invite.code})}
  expect(groups[0].target).not.toBe(groups[1].target);
  const results=await Promise.all(groups.map(g=>f.api('sender','/'+g.id+'/pray',{memberId:g.target})));
  expect(results.filter(r=>!r.alreadySent)).toEqual([{ok:true}]);expect(results.filter(r=>r.alreadySent)).toEqual([{ok:true,alreadySent:true}]);
  const g=groups[1];expect(await f.api('recipient','/'+g.id+'/pray',{memberId:g.sender})).toEqual({ok:true});
  await f.api('third','/join',{code:g.code});expect(await f.api('third','/'+g.id+'/pray',{memberId:g.target})).toEqual({ok:true});
  expect(await f.api('sender','/'+g.id+'/pray',{memberId:g.target})).toEqual({ok:true,alreadySent:true});
 });
 it('retains prayer reservations after either member rejoins and resets at UTC midnight',async()=>{
  const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-11-13T23:59:59Z'));
  const f=fixture();for(const uid of ['host','sender','recipient'])await f.init(uid);
  const c=await f.api('host','',{name:'Rejoin'}),id=c.group.id;
  for(const uid of ['sender','recipient'])await f.api(uid,'/join',{code:c.invite.code});
  const target=()=>getGroups(f.env,'sender').then(out=>out.groups[0].members.find((m:any)=>m.name==='recipient').id);
  const firstTarget=await target();expect(await f.api('sender','/'+id+'/pray',{memberId:firstTarget})).toEqual({ok:true});
  await f.api('recipient','/'+id+'/leave');await expect(f.api('sender','/'+id+'/pray',{memberId:firstTarget})).rejects.toThrow();
  await f.api('recipient','/join',{code:c.invite.code});const newTarget=await target();expect(newTarget).not.toBe(firstTarget);
  expect(await f.api('sender','/'+id+'/pray',{memberId:newTarget})).toEqual({ok:true,alreadySent:true});
  await f.api('sender','/'+id+'/leave');await f.api('sender','/join',{code:c.invite.code});
  expect(await f.api('sender','/'+id+'/pray',{memberId:newTarget})).toEqual({ok:true,alreadySent:true});
  clock.mockReturnValue(Date.parse('2026-11-14T00:00:00Z'));
  expect(await f.api('sender','/'+id+'/pray',{memberId:newTarget})).toEqual({ok:true});
  expect(await f.api('sender','/'+id+'/pray',{memberId:newTarget})).toEqual({ok:true,alreadySent:true});
 });
 it('honors prayer recipient opt-out and push-disabled settings before encrypted delivery',async()=>{
  const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-11-13T12:00:00Z'));
  const f=fixture();await f.init('recipient',{groupReceivePrayer:false,remindersEnabled:true});await f.init('sender',{name:'Grace'});
  const c=await f.api('sender','',{name:'Prayer'}),joined=await f.api('recipient','/join',{code:c.invite.code});
  const pray=()=>f.api('sender','/'+c.group.id+'/pray',{memberId:joined.group.members.find((m:any)=>m.self).id});
  const receiver=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const vapid=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  f.env.VAPID_PUBLIC_KEY=b64(new Uint8Array(await crypto.subtle.exportKey('raw',vapid.publicKey)));f.env.VAPID_PRIVATE_KEY=(await crypto.subtle.exportKey('jwk',vapid.privateKey)).d;
  await f.callUser('recipient','/push/subscribe',{subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/groups-test',keys:{p256dh:b64(new Uint8Array(await crypto.subtle.exportKey('raw',receiver.publicKey))),auth:b64(crypto.getRandomValues(new Uint8Array(16)))}}});
  const network=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(null,{status:201}));
  expect(await pray()).toEqual({ok:true});expect(await pray()).toEqual({ok:true,alreadySent:true});expect(network).not.toHaveBeenCalled();
  await f.callUser('recipient','/sync',{settings:{updatedAt:2,groupReceivePrayer:true,remindersEnabled:false}});
  expect(await pray()).toEqual({ok:true,alreadySent:true});clock.mockReturnValue(Date.parse('2026-11-14T12:00:00Z'));
  expect(await pray()).toEqual({ok:true});expect(network).not.toHaveBeenCalled();
  await f.callUser('recipient','/sync',{settings:{updatedAt:3,remindersEnabled:true}});
  expect(await pray()).toEqual({ok:true,alreadySent:true});clock.mockReturnValue(Date.parse('2026-11-15T12:00:00Z'));
  expect(await pray()).toEqual({ok:true});expect(await pray()).toEqual({ok:true,alreadySent:true});expect(network).toHaveBeenCalledOnce();const init=network.mock.calls[0][1]!;expect(new Headers(init.headers).get('Content-Encoding')).toBe('aes128gcm');expect(new TextDecoder().decode(init.body as Uint8Array)).not.toContain('Grace is praying for you');
 });
 it.each([['2026-03-09T01:00:00Z',true],['2026-11-02T02:14:00Z',true],['2026-11-02T02:15:00Z',false],['2026-11-01T18:00:00Z',false]])('uses local Sunday 18:00 windows across DST: %s',(iso,expected)=>{expect(weeklyWindow(new Date(iso as string),'America/Los_Angeles')).toBe(expected)});
 it('does not resend a weekly reminder when a member leaves and rejoins on the same local Sunday',async()=>{
  const f=fixture();for(const uid of ['owner','other'])await f.init(uid,{remindersEnabled:true,timezone:'America/Los_Angeles'});
  const c=await f.api('owner','',{name:'Weekly rejoin'}),id=c.group.id;
  const joined=await f.api('other','/join',{code:c.invite.code}),oldMember=joined.group.members.find((m:any)=>m.self).id;
  const now=new Date('2026-11-16T02:00:00Z');await scheduleGroups(f.env,now);expect(f.pushBodies).toHaveLength(2);
  await f.api('other','/'+id+'/leave');const rejoined=await f.api('other','/join',{code:c.invite.code});expect(rejoined.group.members.find((m:any)=>m.self).id).not.toBe(oldMember);
  await scheduleGroups(f.env,now);expect(f.pushBodies).toHaveLength(2);
  await scheduleGroups(f.env,new Date('2026-11-23T02:00:00Z'));expect(f.pushBodies).toHaveLength(4);
 });
 it('weekly scheduling reserves once per member/local Sunday and skips small groups, opt-out and push-disabled',async()=>{const f=fixture();for(const u of ['owner','other','disabled'])await f.init(u,{remindersEnabled:u!=='disabled',timezone:'America/Los_Angeles'});const c=await f.api('owner','',{name:'Weekly'}),id=c.group.id;const now=new Date('2026-11-16T02:00:00Z');await scheduleGroups(f.env,now);expect([...(f.groups.get(id) as any).ctx.storage.sql.exec('SELECT id FROM deliveries')]).toHaveLength(0);await f.api('other','/join',{code:c.invite.code});await f.api('disabled','/join',{code:c.invite.code});await f.api('other','/'+id+'/weekly',{enabled:false});await scheduleGroups(f.env,now);const object=f.groups.get(id) as any;expect([...object.ctx.storage.sql.exec('SELECT id FROM deliveries')]).toHaveLength(1);await scheduleGroups(f.env,now);expect([...object.ctx.storage.sql.exec('SELECT id FROM deliveries')]).toHaveLength(1)});
});
