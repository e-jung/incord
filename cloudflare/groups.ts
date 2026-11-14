import type {Env} from './worker';
import {runMcpTool} from './mcp-tools';
import {assertEsvLimit,esvReferenceKeys,isEsv} from '../shared/esv';
const json=(data:unknown)=>Response.json(data,{headers:{'Cache-Control':'no-store'}});
export class GroupsError extends Error { constructor(public status:number,message:string){super(message)} }
export {GroupsError as GroupError};
function check(ok:unknown,message='Invalid request',status=400):asserts ok {if(!ok)throw new GroupsError(status,message)}
export const INVITE_ALPHABET='abcdefghjkmnpqrstuvwxyz23456789';
export function generateInviteCode(){let code='';const ceiling=256-256%INVITE_ALPHABET.length;while(code.length<16){for(const byte of crypto.getRandomValues(new Uint8Array(32))){if(byte<ceiling)code+=INVITE_ALPHABET[byte%INVITE_ALPHABET.length];if(code.length===16)break}}return code}
export function normalizeInviteCode(value:unknown){check(typeof value==='string'&&value.length<=32,'Invalid invite');const code=value.toLowerCase().replace(/-/g,'');check(code.length===16&&[...code].every(c=>INVITE_ALPHABET.includes(c)),'Invalid invite');return code}
export async function groupHash(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('')}
export function equalHash(a:string,b:string){let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0}
type Member={uid:string;id:string;role:'owner'|'admin'|'member';pending:boolean;requestedAt:number;weekly:boolean};
type Group={revision?:number;id:string;name:string;createdAt:number;approveNewMembers:boolean;members:Member[];goal:any;invite?:{hash:string;expiresAt:number;maxUses:number;uses:number};deleted?:boolean};
export async function groupsCall(target:DurableObjectStub,path:string,data:any={}){const response=await target.fetch(new Request('https://internal'+path,{method:'POST',body:JSON.stringify(data)}));const out=await response.json<any>();if(!response.ok)throw new GroupsError(response.status,out.error||'Groups unavailable');return out}
const user=(env:Env,uid:string,path:string,data:any={})=>groupsCall(env.USERS.get(env.USERS.idFromName(uid)),path,data);
const registry=(env:Env,path:string,data:any={})=>groupsCall(env.REGISTRY.get(env.REGISTRY.idFromName('registry')),path,data);
const groupObject=(env:Env,id:string)=>{check(env.GROUPS,'Groups unavailable',503);return env.GROUPS.get(env.GROUPS.idFromName(id))};
const deps=(env:Env)=>({assets:env.ASSETS,read:async()=>({items:[],events:[],settings:{}}),add:async(items:any[])=>({results:items.map(i=>({id:i.id,status:'added'}))})});
export async function resolveGroupGoal(env:Env,selection:any):Promise<{goal:any;items:any[]}>{
 if(selection===null)return {goal:null,items:[]};
 check(selection&&typeof selection==='object'&&!Array.isArray(selection));check(Object.keys(selection).every(k=>['kind','id','translation','start','end'].includes(k)),'Only catalog goals are allowed');
 check(['passage','topic','starter','document'].includes(selection.kind)&&typeof selection.id==='string'&&['BSB','KJV','WEB','ESV'].includes(selection.translation),'Invalid catalog selection');
 const catalog=await runMcpTool('list_collections',{},deps(env));let title='',items:any[]=[];
 if(selection.kind==='passage'||selection.kind==='topic'){
  check(selection.start===undefined&&selection.end===undefined,'Ranges require a document');const list=selection.kind==='passage'?catalog.passages.items:catalog.topics;const entry=list.find((x:any)=>x.id===selection.id);check(entry,'Unknown catalog selection');title=selection.kind==='passage'?entry.reference:entry.title;
  const out=await runMcpTool('add_passages',{items:[{id:selection.id,translation:selection.translation}]},{...deps(env),add:async(found:any[])=>{items=found;return {results:found.map(i=>({id:i.id,status:'added'}))}}});check(out.results[0]?.status==='added','Goal exceeds content limits');
 }else{
  const entry=(selection.kind==='starter'?catalog.starters:catalog.documents).find((x:any)=>x.id===selection.id);check(entry,'Unknown catalog selection');title=entry.title;items=entry.items;
  if(selection.kind==='document'){
   const max=Math.max(...items.map((i:any)=>i.number||1));const start=selection.start??1,end=selection.end??max;check(Number.isInteger(start)&&Number.isInteger(end)&&start>=1&&end>=start&&end<=max,'Invalid question range');items=items.filter((i:any)=>(i.number||1)>=start&&(i.number||1)<=end);
  }else{check(selection.start===undefined&&selection.end===undefined,'Ranges require a document');if(selection.translation!=='BSB'){
   const converted:any[]=[];for(const item of items){if(item.collection!=='bible'){converted.push(item);continue}const found=await runMcpTool('lookup_passage',{reference:item.title,translation:selection.translation},deps(env));converted.push(...found.verses)}items=converted;
  }}
 }
 check(items.length>0&&items.length<=1000,'Goal is too large');try{assertEsvLimit(items)}catch{throw new GroupsError(400,'Goal exceeds ESV content limits')}
 return {goal:{selection:{...selection},title,itemIds:items.map(i=>i.id),total:items.length},items:items.map(i=>({...i,origin:'group'}))};
}
export function groupZone(settings:any){const zone=settings.timezone??settings.timeZone??'UTC';try{new Intl.DateTimeFormat('en',{timeZone:zone});return zone}catch{return 'UTC'}}
const displayName=(state:any)=>String(state.settings?.displayName??state.settings?.name??state.name??'Friend').trim()||'Friend';
const day=(d:Date,zone:string)=>d.toLocaleDateString('en-CA',{timeZone:zone});
export function weeklyWindow(now:Date,zone:string){const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);const get=(t:string)=>parts.find(p=>p.type===t)?.value;return get('weekday')==='Sun'&&get('hour')==='18'&&Number(get('minute'))<15}
function safeEsvTitle(item:any){try{esvReferenceKeys(item.reference||'');return item.reference}catch{return 'ESV passage'}}
export function projectGroupMember(state:any,member:Member,uid:string,goal:any,now=new Date()){
 const s=state.settings||{},zone=groupZone(s),items=(state.items||[]).filter((i:any)=>!i.deleted),dates=new Set<string>((state.events||[]).flatMap((e:any)=>{const d=new Date(e.at??e.timestamp??e.createdAt);return Number.isFinite(+d)?[day(d,zone)]:[]}));
 const today=day(now,zone),anchor=new Date(today+'T12:00:00Z'),dow=(anchor.getUTCDay()+6)%7;anchor.setUTCDate(anchor.getUTCDate()-dow);
 const weekDays=[...dates].filter(d=>d>=anchor.toISOString().slice(0,10)&&d<=today).sort();let streak=0;const cursor=new Date(today+'T12:00:00Z');if(!dates.has(today))cursor.setUTCDate(cursor.getUTCDate()-1);while(dates.has(cursor.toISOString().slice(0,10))){streak++;cursor.setUTCDate(cursor.getUTCDate()-1)}
 const goalItems=items.filter((i:any)=>goal?.itemIds.includes(i.id)),goalLearned=goalItems.filter((i:any)=>i.learned).length;
 return {id:member.id,name:String(s.displayName??s.name??state.name??'Friend').trim()||'Friend',role:member.role,self:member.uid===uid,weekDays,weeklyGoal:s.weeklyGoal??s.goal??4,learnedCount:items.filter((i:any)=>i.learned).length,streak,...(s.groupShareTitles!==false?{titles:items.map((i:any)=>({title:isEsv(i)?safeEsvTitle(i):String(i.title||''),...(isEsv(i)?{translation:'ESV'}:i.translation?{translation:i.translation}:{}),learned:!!i.learned}))}:{}),goalStatus:goal&&goalLearned===goal.total?'learned':goalItems.length?'learning':'not started',goalLearned,goalTotal:goal?.total||0};
}
async function projectView(env:Env,g:Group,uid:string){const me=g.members.find(m=>m.uid===uid);check(me&&!me.pending&&!g.deleted,'Group not found',404);const projected=await groupsCall(groupObject(env,'projection:'+g.id),'/project',{members:g.members.filter(m=>!m.pending||me.role!=='member'),uid,goal:g.goal,key:g.id});const members=projected.members.filter((m:any)=>!m.pending),pending=projected.members.filter((m:any)=>m.pending).map((m:any)=>({id:m.id,name:m.name,requestedAt:m.requestedAt}));return {id:g.id,name:g.name,role:me.role,memberCount:members.length,goal:g.goal,createdAt:g.createdAt,members,...(me.role!=='member'?{pending}:{}),approveNewMembers:g.approveNewMembers,weeklyPush:me.weekly}}
export async function groupView(env:Env,g:Group,uid:string){return groupsCall(groupObject(env,g.id),'/view',{uid,revision:g.revision})}
export function initializeGroupsRegistry(sql:SqlStorage){sql.exec('CREATE TABLE IF NOT EXISTS groups_registry(id TEXT PRIMARY KEY,value TEXT NOT NULL)');sql.exec("CREATE INDEX IF NOT EXISTS groups_invite_hash ON groups_registry(json_extract(value,'$.invite.hash'))");sql.exec('CREATE TABLE IF NOT EXISTS groups_limits(id TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL)')}
/** One registry gate serializes all account caps and membership changes. Canonical rosters contain no user snapshots. */
export async function handleGroupsRegistry(sql:SqlStorage,env:Env,path:string,data:any):Promise<Response|null>{
 if(!path.startsWith('/groups/'))return null;
 const rows=(q:string,...args:(string|number)[])=>[...sql.exec<any>(q,...args)];
 const all=()=>rows('SELECT value FROM groups_registry').map(r=>JSON.parse(r.value) as Group).filter(g=>!g.deleted);
 // Registry owns only the membership/quota/invite gate. A durable outbox is
 // installed BEFORE touching GroupDO, so failures reserve caps and fail closed.
 const writeIndex=(index:any)=>sql.exec('INSERT INTO groups_registry VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',index.id,JSON.stringify(index));
 const indexFor=(g:Group)=>({id:g.id,revision:g.revision,members:g.members,invite:g.invite,deleted:g.deleted});
 const install=async(index:any)=>{await groupsCall(groupObject(env,index.id),'/install',{group:index.pendingGroup});delete index.pendingGroup;writeIndex(index)};
 const save=async(g:Group)=>{g.revision=(g.revision||0)+1;const index={...indexFor(g),pendingGroup:g};writeIndex(index);await install(index)};
 const load=async(index:any):Promise<Group>=>{if(index.pendingGroup)await install(index);const {group}=await groupsCall(groupObject(env,index.id),'/state',{revision:index.revision});return group};
 const owned=(uid:string)=>all().filter(g=>g.members.some(m=>m.uid===uid&&m.role==='owner')).length;
 const total=(uid:string)=>all().filter(g=>g.members.some(m=>m.uid===uid)).length;
 const now=Date.now(),uid=data.uid;
 if(path==='/groups/list'){const memberships=all().filter(g=>g.members.some(m=>m.uid===uid));for(const g of memberships)if((g as any).pendingGroup)await load(g);const index=(g:Group)=>({id:g.id,revision:g.revision});return json({groups:memberships.filter(g=>g.members.some(m=>m.uid===uid&&!m.pending)).map(index),pending:memberships.filter(g=>g.members.some(m=>m.uid===uid&&m.pending)).map(index)})}
 if(path==='/groups/schedule')return json({groups:all().map(g=>({id:g.id,revision:g.revision}))});
 if(path==='/groups/cleanup'){for(const index of all()){const m=index.members.find(m=>m.uid===uid);if(!m)continue;const g=await load(index);if(m.role==='owner'){g.deleted=true;g.invite=undefined;g.members=[]}else g.members=g.members.filter(m=>m.uid!==uid);await save(g)}return json({ok:true})}
 if(path==='/groups/create'){
  check(total(uid)<5,'You may belong to five groups',409);check(owned(uid)<3,'You may own three groups',409);const name=groupName(data.name);check(data.approveNewMembers===undefined||typeof data.approveNewMembers==='boolean');
  const g:Group={id:crypto.randomUUID(),name,createdAt:now,approveNewMembers:data.approveNewMembers===true,members:[{uid,id:crypto.randomUUID(),role:'owner',pending:false,requestedAt:now,weekly:true}],goal:null};const invite=await inviteFor(g,{});await save(g);return json({group:g,invite});
 }
 if(path==='/groups/join'){
  sql.exec('DELETE FROM groups_limits WHERE expires<=?',now);
  for(const [key,limit,window] of [[await groupHash(env.SESSION_SECRET+':join-account:'+uid),10,3600000],[await groupHash(env.SESSION_SECRET+':join-ip:'+data.ip),50,86400000]] as const){const old=rows('SELECT count,expires FROM groups_limits WHERE id=?',key)[0];check(!old||old.expires<=now||old.count<limit,'Too many join attempts',429);sql.exec('INSERT INTO groups_limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END',key,now+window,now,now)}
  const hash=await groupHash(normalizeInviteCode(data.code));const match=rows("SELECT value FROM groups_registry WHERE json_extract(value,'$.invite.hash')=?",hash)[0];const g:Group|undefined=match?await load(JSON.parse(match.value)):undefined;check(g&&!g.deleted&&g.invite&&equalHash(g.invite.hash,hash)&&g.invite.expiresAt>now,'Invite expired or unavailable',404);
  if(!g.members.some(m=>m.uid===uid)){check(g.invite.uses<g.invite.maxUses,'Invite expired or unavailable',404);check(total(uid)<5,'You may belong to five groups',409);check(g.approveNewMembers||g.members.filter(m=>!m.pending).length<30,'Group is full',409);g.members.push({uid,id:crypto.randomUUID(),role:'member',pending:g.approveNewMembers,requestedAt:now,weekly:true});g.invite.uses++;await save(g)}return json({group:g});
 }
 const index=all().find(g=>g.id===data.id);check(index,'Group not found',404);const g=await load(index);const action=path.slice(8);const me=g.members.find(m=>m.uid===uid&&(!m.pending||action==='leave'));check(me,'Group not found',404);const target=g.members.find(m=>m.id===data.memberId);
 const manage=()=>check(me.role!=='member','Not allowed',403),owner=()=>check(me.role==='owner','Owner required',403);
 let extra:any={};
 if(action==='get')return json({group:g});
 if(action==='update'){manage();if(data.name!==undefined)g.name=groupName(data.name);if(data.approveNewMembers!==undefined){check(typeof data.approveNewMembers==='boolean');g.approveNewMembers=data.approveNewMembers}}
 else if(action==='invite'){manage();extra=await inviteFor(g,data)}
 else if(action==='invite/revoke'){manage();g.invite=undefined}
 else if(action==='approve'){manage();check(target,'Pending member not found',404);if(!target.pending)return json({ok:true});check(g.members.filter(m=>!m.pending).length<30,'Group is full',409);target.pending=false}
 else if(action==='remove'){manage();if(!target)return json({ok:true});check(target&&target.role!=='owner'&&(me.role==='owner'||target.role==='member'),'Not allowed',403);g.members=g.members.filter(m=>m!==target)}
 else if(action==='role'){owner();check(target&&!target.pending&&target.role!=='owner'&&['admin','member'].includes(data.role),'Invalid role');target.role=data.role}
 else if(action==='transfer'){owner();check(target&&!target.pending&&target!==me,'Choose an active member');check(owned(target.uid)<3,'New owner already owns three groups',409);me.role='member';target.role='owner'}
 else if(action==='leave'){check(me.role!=='owner','Transfer ownership or delete the group first',409);g.members=g.members.filter(m=>m!==me)}
 else if(action==='delete'){owner();g.deleted=true;g.members=[];g.invite=undefined}
 else if(action==='goal'){manage();g.goal=(await resolveGroupGoal(env,data.selection)).goal}
 else if(action==='weekly'){check(typeof data.enabled==='boolean');me.weekly=data.enabled}
 else if(action==='goal/add'){check(g.goal,'No group goal');const {items}=await resolveGroupGoal(env,g.goal.selection);return json(await user(env,uid,'/groups/add',{items}))}
 else if(action==='pray'){check(target&&!target.pending&&target!==me,'Choose another member');const sender=await user(env,uid,'/groups/state');return json(await user(env,target.uid,'/groups/prayer',{senderHash:await groupHash(uid),kind:'prayer',body:`${String(sender.settings.displayName??sender.settings.name??sender.name??'Friend').trim()||'Friend'} is praying for you as you memorize.`,tag:'incord-prayer-'+g.id}))}
 else throw new GroupsError(404,'Not found');await save(g);return json({group:g,...extra});
}
function groupName(name:any){check(typeof name==='string'&&name.trim().length>0&&name.trim().length<=80,'Enter a group name (1–80 characters)');return name.trim()}
async function inviteFor(g:Group,data:any){const days=data.expiresDays??14,uses=data.maxUses??20;check(Number.isInteger(days)&&days>=1&&days<=90&&Number.isInteger(uses)&&uses>=1&&uses<=100,'Invalid invite limits');const raw=generateInviteCode(),expiresAt=Date.now()+days*86400000;g.invite={hash:await groupHash(raw),expiresAt,maxUses:uses,uses:0};return {code:raw.match(/.{4}/g)!.join('-'),url:'/join/'+raw,expiresAt,maxUses:uses}}
export async function getGroups(env:Env,uid:string):Promise<{groups:any[];pending:{id:string;name:string;ownerName:string;requestedAt:number}[]}>{if(!env.GROUPS)return {groups:[],pending:[]};const result=await registry(env,'/groups/list',{uid});const groups=[],pending=[];for(const g of result.groups)groups.push(await groupView(env,g,uid));for(const g of result.pending||[])pending.push(await groupsCall(groupObject(env,g.id),'/pending-view',{uid,revision:g.revision}));return {groups,pending}}
export type GroupsAttention={pendingRequests:number;prayersToday:number;goalsNearlyDone:number;groupId?:string};
/** Reuse authorized list projections: no additional member/library reads.
 * Nearly done means the current user's started goal is >=80% learned,
 * with exactly one or two items remaining (completed goals do not qualify). */
export function projectGroupsAttention(groups:any[],prayersToday:number):GroupsAttention{
 let pendingRequests=0,goalsNearlyDone=0,pendingGroup:string|undefined,goalGroup:string|undefined;
 for(const g of groups){
  const requests=g.role==='owner'||g.role==='admin'?(g.pending?.length||0):0;
  pendingRequests+=requests;if(requests&&!pendingGroup)pendingGroup=g.id;
  const me=g.members.find((m:any)=>m.self),total=me?.goalTotal||0,learned=me?.goalLearned||0,remaining=total-learned;
  if(g.goal&&me?.goalStatus==='learning'&&learned/total>=0.8&&remaining>=1&&remaining<=2){goalsNearlyDone++;goalGroup??=g.id}
 }
 const groupId=pendingGroup??goalGroup;
 return {pendingRequests,prayersToday,goalsNearlyDone,...(groupId?{groupId}:{})};
}
export async function cleanupGroups(env:Env,uid:string){if(env.GROUPS)await registry(env,'/groups/cleanup',{uid})}
export async function handleGroups(request:Request,env:Env,uid:string,input:any={}){
 check(env.GROUPS,'Groups unavailable',503);const path=new URL(request.url).pathname;
 if(path==='/api/groups'&&request.method==='GET'){
  const result=await getGroups(env,uid);
  // One scalar-only account read, independent of group count and push setup.
  const {prayersToday}=await user(env,uid,'/groups/attention');
  return json({...result,attention:projectGroupsAttention(result.groups,prayersToday)});
 }
 const parts=path.slice('/api/groups'.length).split('/').filter(Boolean);let action:string,id:string|undefined;
 if(!parts.length&&request.method==='POST')action='create';else if(parts.length===1&&parts[0]==='join'&&request.method==='POST')action='join';else {id=parts.shift();check(id&&/^[a-f0-9-]{36}$/.test(id),'Group not found',404);action=parts.join('/')||(request.method==='GET'?'get':request.method==='DELETE'?'delete':'');check((action==='get'&&request.method==='GET')||(action==='delete'&&request.method==='DELETE')||(!!parts.length&&request.method==='POST'),'Method not allowed',405)}
 const result=await registry(env,'/groups/'+action,{...input,uid,id,ip:request.headers.get('CF-Connecting-IP')||'local'});
 if(action==='join'){const me=result.group.members.find((m:Member)=>m.uid===uid);return json(me.pending?{pending:true,...await groupsCall(groupObject(env,result.group.id),'/pending-view',{uid,revision:result.group.revision})}:{group:await groupView(env,result.group,uid)})}
 if(['get','create','update','goal'].includes(action))return json({group:await groupView(env,result.group,uid),...(action==='create'?{invite:result.invite}:{})});
 if(action==='invite')return json({code:result.code,url:result.url,expiresAt:result.expiresAt,maxUses:result.maxUses});
 return json(action==='pray'||action==='goal/add'?result:{ok:true});
}
/** Actual group state is SQLite-backed here; never persists user library snapshots.
 * Dispatch/projection helpers share the namespace but never call the Registry.
 * Every invocation has <=30 external calls, for projection; scheduling uses at most 32 (30 reads + 2 delivery batches). */
export class GroupDO {
 constructor(private ctx:DurableObjectState,private env:Env={} as Env){const sql=ctx.storage.sql;sql.exec('CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY)');sql.exec('CREATE TABLE IF NOT EXISTS membership_notifications(id TEXT PRIMARY KEY,value TEXT NOT NULL)');sql.exec('CREATE TABLE IF NOT EXISTS group_state(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL)')}
 async fetch(request:Request){return this.ctx.blockConcurrencyWhile(async()=>{try{
  const data=await request.json<any>(),path=new URL(request.url).pathname,sql=this.ctx.storage.sql;
  if(path==='/install'){
   const oldRow=[...sql.exec<any>('SELECT value FROM group_state WHERE id=1')][0],old:Group|undefined=oldRow?JSON.parse(oldRow.value):undefined,g:Group=data.group;
   if(!old||(old.revision||0)<g.revision!){
    // Persist notification intents atomically with the roster. Reservations live in
    // this GroupDO, not on ephemeral member ids, so withdrawal/rejoin cannot spam.
    this.ctx.storage.transactionSync(()=>{
     for(const member of g.members){
      const previous=old?.members.find(m=>m.uid===member.uid);
      const kind=member.pending&&!previous?'join':previous?.pending&&!member.pending?'approved':null;
      if(!kind)continue;
      const id=kind==='join'?`join:${member.uid}`:`approved:${member.id}`;
      if([...sql.exec('SELECT id FROM deliveries WHERE id=?',id)].length)continue;
      const recipients=kind==='join'?g.members.filter(m=>!m.pending&&m.role!=='member').map(m=>({uid:m.uid})):[{uid:member.uid}];
      sql.exec('INSERT OR IGNORE INTO membership_notifications VALUES(?,?)',id,JSON.stringify({kind,requester:member.uid,recipients,name:g.name,groupId:g.id}));
     }
     sql.exec('INSERT INTO group_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',JSON.stringify(g));
    });
   }
   for(const row of [...sql.exec<any>('SELECT id,value FROM membership_notifications')]){
    // Reserve before dispatch, matching prayer/weekly at-most-once delivery.
    sql.exec('INSERT OR IGNORE INTO deliveries VALUES(?)',row.id);sql.exec('DELETE FROM membership_notifications WHERE id=?',row.id);
    await groupsCall(groupObject(this.env,'membership:'+g.id),'/membership-notify',JSON.parse(row.value));
   }
   return json({ok:true});
  }
  if(path==='/membership-notify'){
   const body=data.kind==='join'?`${displayName(await user(this.env,data.requester,'/groups/state'))} asked to join ${data.name}`:`You’re in ${data.name}`;
   for(let i=0;i<data.recipients.length;i+=15)await groupsCall(groupObject(this.env,'delivery:'+data.groupId+':membership:'+i),'/deliver',{recipients:data.recipients.slice(i,i+15),kind:data.kind,body,tag:'incord-group-'+data.kind+'-'+data.groupId+'-'+await groupHash(data.requester)});
   return json({ok:true});
  }
  if(path==='/project'){
   if(data.members.length>30){const mid=Math.ceil(data.members.length/2);const batches=await Promise.all([data.members.slice(0,mid),data.members.slice(mid)].map((members,i)=>groupsCall(groupObject(this.env,'projection:'+String(data.key||'root')+':'+i),'/project',{...data,members,key:String(data.key||'root')+':'+i})));return json({members:batches.flatMap(b=>b.members)})}
   const members=[];for(const member of data.members){const state=await user(this.env,member.uid,'/groups/state');members.push(member.pending?{id:member.id,name:String(state.settings?.displayName??state.settings?.name??state.name??'Friend').trim()||'Friend',requestedAt:member.requestedAt,pending:true}:projectGroupMember(state,member,data.uid,data.goal))}return json({members});
  }
  if(path==='/schedule-tree'){
   if(data.groups.length>20){const mid=Math.ceil(data.groups.length/2);for(const [i,groups] of [data.groups.slice(0,mid),data.groups.slice(mid)].entries())await groupsCall(groupObject(this.env,'scheduler:'+String(data.key||'root')+':'+i),'/schedule-tree',{...data,groups,key:String(data.key||'root')+':'+i})}
   else for(const g of data.groups)await groupsCall(groupObject(this.env,g.id),'/schedule',{revision:g.revision,now:data.now});return json({ok:true});
  }
  if(path==='/remind-tree'){if(data.users.length>30){const mid=Math.ceil(data.users.length/2);for(const [i,users] of [data.users.slice(0,mid),data.users.slice(mid)].entries())await groupsCall(groupObject(this.env,'reminders:'+String(data.key||'root')+':'+i),'/remind-tree',{users,key:String(data.key||'root')+':'+i})}else for(const uid of data.users)await user(this.env,uid,'/push/remind');return json({ok:true})}
  if(path==='/deliver'){for(const recipient of data.recipients)await user(this.env,recipient.uid,'/groups/push',{kind:data.kind||'weekly',body:data.body,tag:data.tag});return json({ok:true})}
  const reserve=(key:string)=>{if([...sql.exec('SELECT id FROM deliveries WHERE id=?',key)].length)return false;sql.exec('INSERT INTO deliveries VALUES(?)',key);return true};
  const row=[...sql.exec<any>('SELECT value FROM group_state WHERE id=1')][0];check(row,'Group not found',404);const g:Group=JSON.parse(row.value);
  check(g.revision===data.revision,'Group update pending; retry shortly',503);
  if(path==='/state')return json({group:g});check(!g.deleted,'Group not found',404);
  if(path==='/pending-view'){const me=g.members.find(m=>m.uid===data.uid&&m.pending);check(me,'Group not found',404);const owner=g.members.find(m=>m.role==='owner')!;const ownerName=displayName(await user(this.env,owner.uid,'/groups/state'));return json({id:g.id,name:g.name,ownerName,requestedAt:me.requestedAt})}
  if(path==='/view')return json(await projectView(this.env,g,data.uid));
  if(path==='/schedule'){
   const active=g.members.filter(m=>!m.pending);if(active.length<2)return json({ok:true});const now=new Date(data.now),states=[];
   for(const member of active)states.push({member,state:await user(this.env,member.uid,'/groups/state')});
   const views=states.map(({member,state})=>projectGroupMember(state,member,'',g.goal,now));
   const practiced=views.filter(m=>m.weekDays.length>0).length,learned=views.reduce((sum,m)=>sum+m.goalLearned,0);
   const body=`${g.name}: ${practiced} practiced${g.goal?` · ${g.goal.title}: ${learned} of ${g.goal.total*active.length} learned`:''}. Keep growing together.`;
   const recipients=states.filter(({member,state})=>{const settings=state.settings||{},zone=groupZone(settings);return member.weekly&&(settings.remindersEnabled??settings.pushEnabled)&&weeklyWindow(now,zone)&&reserve(`weekly:${member.uid}:${day(now,zone)}`)}).map(({member})=>({uid:member.uid}));
   for(let i=0;i<recipients.length;i+=15)await groupsCall(groupObject(this.env,'delivery:'+g.id+':'+i),'/deliver',{recipients:recipients.slice(i,i+15),body,tag:'incord-weekly-'+g.id});return json({ok:true});
  }
  throw new GroupsError(404,'Not found');
 }catch(error){if(error instanceof GroupsError)return jsonError(error);throw error}})}
}
function jsonError(error:GroupsError){return Response.json({error:error.message},{status:error.status})}
export async function scheduleGroups(env:Env,now=new Date()){
 if(!env.GROUPS)return;const {groups}=await registry(env,'/groups/schedule');await groupsCall(groupObject(env,'scheduler'),'/schedule-tree',{groups,now:now.toISOString()});
}

export async function dispatchGroupReminders(env:Env,users:string[]){if(env.GROUPS)await groupsCall(groupObject(env,'reminders'),'/remind-tree',{users});else await Promise.all(users.map(uid=>user(env,uid,'/push/remind')))}
