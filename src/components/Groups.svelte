<script lang="ts">
import {onMount, untrack} from 'svelte';
import {api, type Settings} from '../store';
import {copy as ui} from '../config/copy';
import Sheet from './Sheet.svelte';
import WeekDots from './WeekDots.svelte';

type Role = 'owner' | 'admin' | 'member';
type Goal = {title:string; total:number; itemIds:string[]; selection:{translation:string;kind?:string;id?:string}};
type Pending = {id:string;name:string;requestedAt:number};
type Summary = {id:string; name:string; role:Role; memberCount:number; goal:Goal|null};
type Member = {id:string; name:string; role:Role; self:boolean; weekDays:string[]; weeklyGoal:number; learnedCount:number; streak:number; titles?:{title:string; translation?:string; learned:boolean}[]; goalStatus:string; goalLearned:number; goalTotal:number};
type Group = Summary & {members:Member[]; pending?:{id:string; name:string}[]; approveNewMembers:boolean; weeklyPush:boolean};
type Invite = {code:string; url:string; expiresAt:number; maxUses:number};
type Note = {text:string; error?:boolean};
type Confirmation = {kind:'delete'|'leave'|'remove'|'transfer'; member?:Member};
let {account, settings, onSync, onChooseGoal, onSignIn, pendingCode='', onJoined, initialGroupId='', onSave, onDialogChange=()=>{}}: {
 account:any|null; settings:Settings; onSync:()=>Promise<void>; onChooseGoal:(groupId:string)=>void;
 onSignIn:()=>void; pendingCode?:string; onJoined:()=>void; initialGroupId?:string; onSave?:()=>Promise<void>; onDialogChange?:(close:(()=>void)|null)=>void;
} = $props();
let pendingMemberships = $state<Pending[]>([]);
let groups = $state<Summary[]>([]), group = $state<Group|null>(null), selected = $state('');
let activeIdentity = $state(''), loading = $state(false), detailLoading = $state(false);
let busy = $state(''), notes = $state<Record<string,Note>>({}), invite = $state<Invite|null>(null);
let name = $state(''), code = $state(''), approval = $state(false), expiresDays = $state(14), maxUses = $state(20);
let confirmation = $state<Confirmation|null>(null);
let inviteInput = $state<HTMLInputElement>();
let formsOpen = $state(false);
let epoch = 0, listRequest = 0, detailRequest = 0, alive = true, attemptedInvite = '';
const manager = $derived(group?.role === 'owner' || group?.role === 'admin');
const owner = $derived(group?.role === 'owner');
const visible = $derived(!!account && String(account.id) === activeIdentity);
const message = (key:string, text:string, error=false) => {notes = {...notes, [key]:{text,error}}};
const clearNote = (key:string) => {const next={...notes};delete next[key];notes=next};
const current = (version:number) => alive && version === epoch && !!account && String(account.id) === activeIdentity;
function weekDotDays(days:string[]){return days.map(value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return value;const [year,month,date]=value.split('-').map(Number);return new Date(year,month-1,date).toLocaleDateString(ui.dateLocale)})}
const path = (id:string, suffix='') => `/groups/${encodeURIComponent(id)}${suffix}`;
const errorText = (error:unknown) => error instanceof Error ? error.message : ui.groups.retry;
function clearDetail(){group=null;invite=null;confirmation=null;detailRequest++;detailLoading=false;}
function reset(identity:string){
 epoch++;listRequest++;clearDetail();groups=[];pendingMemberships=[];selected='';notes={};busy='';loading=false;
 name='';code='';formsOpen=!!pendingCode;approval=false;expiresDays=14;maxUses=20;activeIdentity=identity;attemptedInvite='';
}
$effect(()=>{
 const identity=account ? String(account.id) : '';
 untrack(()=>{if(identity!==activeIdentity){reset(identity);if(identity)void refresh(true)}});
});
$effect(()=>{
 const identity=account ? String(account.id) : '', pending=pendingCode, running=busy;
 untrack(()=>{if(!running && identity && identity===activeIdentity && pending && attemptedInvite!==`${identity}:${pending}`){
  attemptedInvite=`${identity}:${pending}`;formsOpen=true;code=pending;void join(pending);
 }});
});
$effect(()=>{
 const id=initialGroupId, identity=account ? String(account.id) : '';
 untrack(()=>{if(id && identity && identity===activeIdentity && selected!==id){clearDetail();selected=id;void loadDetail(id)}});
});
$effect(()=>{const open=confirmation;onDialogChange(open?()=>{confirmation=null}:null)});
onMount(()=>{
 const focus=()=>{if(document.visibilityState==='visible' && visible && !busy)void refresh()};
 window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);
 return()=>{onDialogChange(null);alive=false;epoch++;window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus)};
});
async function loadDetail(id:string){
 const version=epoch, request=++detailRequest;detailLoading=true;clearNote('detail');
 try{const out=await api(path(id));if(!current(version)||request!==detailRequest||selected!==id)return;group=out.group;if(group?.role!=='owner'&&group?.role!=='admin')invite=null}
 catch(error){if(current(version)&&request===detailRequest&&selected===id){group=null;invite=null;message('detail',errorText(error),true)}}
 finally{if(current(version)&&request===detailRequest)detailLoading=false}
}
async function refresh(first=false){
 if(!account)return;
 const version=epoch,request=++listRequest;loading=true;clearNote('list');
 try{
  const out=await api('/groups');if(!current(version)||request!==listRequest)return;
  groups=out.groups;pendingMemberships=out.pending||[];
  if(selected&&!groups.some(g=>g.id===selected)){clearDetail();selected=''}
  if(!selected&&groups.length)selected=(first&&initialGroupId&&groups.some(g=>g.id===initialGroupId))?initialGroupId:groups[0].id;
  if(selected)await loadDetail(selected);
 }catch(error){if(current(version)&&request===listRequest)message('list',errorText(error),true)}
 finally{if(current(version)&&request===listRequest)loading=false}
}
function choose(id:string){if(id===selected)return;clearDetail();selected=id;notes={};void loadDetail(id)}
function cancelReads(){listRequest++;detailRequest++;loading=false;detailLoading=false}
async function withdraw(id:string){
 if(busy)return;cancelReads();const version=epoch;busy='withdraw:'+id;clearNote('requests');
 try{await api(path(id,'/leave'),{});if(!current(version))return;pendingMemberships=pendingMemberships.filter(item=>item.id!==id);await refresh();if(current(version))message('requests',ui.groups.requestWithdrawn)}
 catch(error){if(current(version))message('requests',errorText(error),true)}
 finally{if(current(version))busy=''}
}
async function create(){
 if(busy||!name.trim())return;
 cancelReads();const version=epoch;busy='create';clearNote('create');
 try{
  const out=await api('/groups',{name:name.trim(),approveNewMembers:approval});if(!current(version))return;
  clearDetail();group=out.group;selected=out.group.id;invite=out.invite||null;name='';
  await refresh();if(current(version))message('create',ui.groups.created);
 }catch(error){if(current(version))message('create',errorText(error),true)}
 finally{if(current(version))busy=''}
}
async function join(value=code){
 if(!account||busy||!value.trim())return;
 cancelReads();const version=epoch;busy='join';clearNote('join');
 try{
  const out=await api('/groups/join',{code:value.trim()});if(!current(version))return;
  if(out.pending){message('join',ui.groups.awaitingApproval(out.name));code='';onJoined();await refresh();return}
  if(!out.group)throw new Error(ui.groups.inviteInvalid);
  clearDetail();group=out.group;selected=out.group.id;code='';onJoined();
  await refresh();if(current(version))message('join',ui.groups.joined);
 }catch(error){if(current(version))message('join',errorText(error),true)}
 finally{if(current(version))busy=''}
}
async function mutate(key:string,suffix:string,body:unknown={},success:string=ui.groups.saved,options:{method?:string; forget?:boolean; sync?:boolean}={}){
 if(!group||busy)return;
 cancelReads();const version=epoch,id=group.id;busy=key;clearNote(key);
 try{
  // Start the network request directly in the click handler, including prayer.
  const out=await api(path(id,suffix),body,options.method);if(!current(version)||selected!==id)return;
  if(options.forget){clearDetail();groups=groups.filter(g=>g.id!==id);selected='';}
  if(suffix==='/remove'&&group){const memberId=(body as {memberId:string}).memberId;group={...group,members:group.members.filter(member=>member.id!==memberId),pending:group.pending?.filter(member=>member.id!==memberId)}}
  if(key==='confirm')confirmation=null;
  if(suffix==='/invite')invite=out;
  if(suffix==='/invite/revoke')invite=null;
  if(options.sync){try{await onSync()}catch{if(current(version))message(key,ui.groups.syncIncomplete,true);return}}
  if(suffix==='/goal/add'){const rejected=(out.results||[]).filter((item:any)=>!['added','already in library'].includes(item.status));if(rejected.length){if(current(version)){await refresh();message(key,ui.groups.goalRejected(rejected.length,rejected[0].reason||ui.groups.retry),true)}return}}
  if(!current(version))return;
  if(suffix!=='/pray')await refresh();
  if(current(version))message(key,suffix==='/pray'&&out.alreadySent?ui.groups.prayerAlreadySent:success);
 }catch(error){if(current(version)&&selected===id)message(key,errorText(error),true)}
 finally{if(current(version))busy=''}
}
async function weekly(enabled:boolean){
 if(!group||busy)return;
 cancelReads();const version=epoch,id=group.id,old=group.weeklyPush;group={...group,weeklyPush:enabled};busy='weekly';clearNote('weekly');
 try{await api(path(id,'/weekly'),{enabled});if(current(version)&&group?.id===id)message('weekly',enabled?ui.groups.weeklyOn:ui.groups.weeklyOff)}
 catch(error){if(current(version)&&group?.id===id){group={...group,weeklyPush:old};message('weekly',errorText(error),true)}}
 finally{if(current(version))busy=''}
}
async function copyInvite(){
 if(!invite)return;const version=epoch,id=selected;
 try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(new URL(invite.url,location.origin).href);if(current(version)&&selected===id)message('copy',ui.groups.inviteCopied)}
 catch{if(current(version)&&selected===id){inviteInput?.focus();inviteInput?.select();message('copy',ui.groups.inviteCopyFallback)}}
}
function confirmAction(){
 if(!confirmation||!group)return;
 const {kind,member}=confirmation;
 if(kind==='delete')void mutate('confirm','',undefined,ui.groups.deleted,{method:'DELETE',forget:true});
 else if(kind==='leave')void mutate('confirm','/leave',{},ui.groups.left,{forget:true});
 else if(kind==='remove'&&member)void mutate('confirm','/remove',{memberId:member.id},ui.groups.memberRemoved);
 else if(kind==='transfer'&&member)void mutate('confirm','/transfer',{memberId:member.id},ui.groups.ownershipTransferred);
}
const confirmationTitle = $derived(confirmation?.kind==='delete'?ui.groups.deleteTitle:confirmation?.kind==='leave'?ui.groups.leaveTitle:confirmation?.kind==='transfer'?ui.groups.transferTitle:ui.groups.removeTitle);
</script>

{#snippet feedback(key:string)}
 {#if notes[key]}<p class="feedback" class:failed={notes[key].error} role={notes[key].error?'alert':'status'}>{notes[key].text}</p>{/if}
{/snippet}

<section class="groups-panel" aria-labelledby="groups-heading">
 <header class="heading"><h2 id="groups-heading">{ui.groups.heading}</h2>{#if visible}<button class="text-button" disabled={loading||!!busy} onclick={()=>void refresh()}>{loading?ui.groups.refreshing:ui.groups.refresh}</button>{/if}</header>
 <p class="intro">{ui.groups.intro}</p>
 {#if !account}
  <p>{pendingCode?ui.groups.signInInvite:ui.groups.signInHelp}</p>
  <button class="secondary" onclick={onSignIn}>{ui.groups.signIn}</button>
 {:else if visible}
  {@render feedback('list')}
  {#if loading&&!groups.length}<p role="status">{ui.groups.loadingList}</p>{/if}
  {#if groups.length}
   <nav class="group-list" aria-label={ui.groups.listLabel}>
    {#each groups as item (item.id)}
     <button class="group-choice secondary" class:chosen={selected===item.id} aria-pressed={selected===item.id} disabled={!!busy} onclick={()=>choose(item.id)}><strong>{item.name}</strong><small>{ui.groups.choiceSummary(item.memberCount,item.role)}</small></button>
    {/each}
   </nav>
  {:else if !loading&&!notes.list}<p>{ui.groups.empty}</p>{/if}
  {#if pendingMemberships.length}<section class="panel stack" aria-label={ui.groups.yourRequests}><h3>{ui.groups.yourRequests}</h3>{#each pendingMemberships as item (item.id)}<div class="stack"><strong>{item.name}</strong><small>{ui.groups.awaitingApproval(item.name)}</small><button class="text-button" disabled={!!busy} onclick={()=>void withdraw(item.id)}>{busy==='withdraw:'+item.id?ui.groups.withdrawing:ui.groups.withdraw}</button></div>{/each}</section>{/if}
  {@render feedback('requests')}
  <details class="panel" bind:open={formsOpen}>
   <summary>{ui.groups.createOrJoin}</summary>
   <div class="forms">
    <form class="stack" onsubmit={(event)=>{event.preventDefault();void create()}}>
     <h3>{ui.groups.createHeading}</h3>
     <label>{ui.groups.name}<input bind:value={name} maxlength="80" required autocomplete="off" /></label>
     <label class="check"><input type="checkbox" bind:checked={approval} />{ui.groups.approveNew}</label>
     <button type="submit" disabled={!!busy||!name.trim()}>{busy==='create'?ui.groups.creating:ui.groups.create}</button>
     {@render feedback('create')}
    </form>
    <form class="stack" onsubmit={(event)=>{event.preventDefault();void join()}}>
     <h3>{ui.groups.joinHeading}</h3>
     <label>{ui.groups.inviteCode}<input bind:value={code} required maxlength="64" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder={ui.groups.invitePlaceholder} /></label>
     <button type="submit" disabled={!!busy||!code.trim()}>{busy==='join'?ui.groups.joining:ui.groups.join}</button>
     {@render feedback('join')}
    </form>
   </div>
  </details>
  {#if !formsOpen}{@render feedback('join')}{@render feedback('create')}{/if}
  {#if !confirmation}{@render feedback('confirm')}{/if}
  {@render feedback('detail')}
  {#if detailLoading&&!group}<p role="status">{ui.groups.loadingDetail}</p>{/if}
  {#if group}
   <article class="panel stack" aria-label={group.name} aria-busy={detailLoading}>
    <header><h3 class="group-name">{group.name}</h3><small>{ui.groups.memberSummary(group.memberCount,group.role)}</small></header>
    <section class="stack goal" aria-label={ui.groups.goalHeading}>
     <h3>{ui.groups.goalHeading}</h3>
     {#if group.goal}
      <strong>{group.goal.title}</strong>
      <small>{ui.groups.goalSummary(group.goal.selection.kind==='passage'||group.goal.selection.kind==='topic'||(group.goal.selection.kind==='starter'&&['gospel','psalm23'].includes(group.goal.selection.id||''))?group.goal.selection.translation:undefined,group.goal.total)}</small>
      {@const self=group.members.find(member=>member.self)}
      {#if self}<p>{ui.groups.goalLearnedByYou(self.goalLearned,self.goalTotal)}</p>{/if}
      <button disabled={!!busy} onclick={()=>void mutate('goal','/goal/add',{},ui.groups.goalAdded,{sync:true})}>{busy==='goal'?ui.groups.adding:ui.groups.addGoal}</button>
      {@render feedback('goal')}
     {:else}<p>{ui.groups.noGoal}</p>{/if}
     {#if manager}<button class="text-button" disabled={!!busy} onclick={()=>onChooseGoal(group!.id)}>{ui.groups.chooseGoal}</button>{/if}
    </section>
    <section class="stack" aria-label={ui.groups.membersLabel}>
     <h3>{ui.groups.membersHeading}</h3>
     <ul class="members">
      {#each group.members as member (member.id)}
       <li class="member">
        <div class="member-heading"><strong>{ui.groups.memberName(member.name,member.self)}</strong><small>{ui.groups.roles[member.role]}</small></div>
        <WeekDots days={weekDotDays(member.weekDays)} />
        <p class="metrics">{ui.groups.weekPracticed(new Set(member.weekDays).size,member.weeklyGoal)}<br />{ui.groups.learnedAndStreak(member.learnedCount,member.streak)}</p>
        {#if group.goal}<p class="metrics">{ui.groups.goalProgress(member.goalStatus,member.goalLearned,member.goalTotal)}</p>{/if}
        {#if member.titles?.length&&(!member.self||(settings as Settings&{groupShareTitles?:boolean}).groupShareTitles!==false)}
         <details class="titles"><summary>{ui.groups.titles}</summary><ul>{#each member.titles as title,index (`${index}:${title.title}:${title.translation}`)}<li><span>{title.title}</span>{#if title.translation}<small class="translation">{title.translation}</small>{/if}<small>{title.learned?ui.groups.learned:ui.groups.memorizing}</small></li>{/each}</ul></details>
        {/if}
        {#if !member.self}
         <button class="text-button" disabled={!!busy} aria-label={ui.groups.prayFor(member.name)} onclick={()=>void mutate(`pray:${member.id}`,'/pray',{memberId:member.id},ui.groups.prayerSent)}>{busy===`pray:${member.id}`?ui.groups.sending:ui.groups.pray}</button>
         {@render feedback(`pray:${member.id}`)}
         {#if manager&&member.role!=='owner'&&(owner||member.role==='member')}
          <details class="member-controls"><summary>{ui.groups.manageMember(member.name)}</summary><div class="stack">
           {#if owner}<label>{ui.groups.roleFor(member.name)}<select value={member.role} disabled={!!busy} onchange={(event)=>{const role=event.currentTarget.value;event.currentTarget.value=member.role;void mutate(`role:${member.id}`,'/role',{memberId:member.id,role},ui.groups.roleUpdated)}}><option value="member">{ui.groups.memberRole}</option><option value="admin">{ui.groups.adminRole}</option></select></label>{@render feedback(`role:${member.id}`)}{/if}
           <button class="text-button danger" disabled={!!busy} onclick={()=>{clearNote('confirm');confirmation={kind:'remove',member}}}>{ui.groups.removeMember}</button>
           {#if owner}<button class="text-button" disabled={!!busy} onclick={()=>{clearNote('confirm');confirmation={kind:'transfer',member}}}>{ui.groups.transferTo(member.name)}</button>{/if}
          </div></details>
         {/if}
        {/if}
       </li>
      {/each}
     </ul>
    </section>
    <section class="stack" aria-label={ui.groups.notificationsLabel}>
     <label class="check"><input type="checkbox" checked={group.weeklyPush!==false} disabled={!!busy} onchange={(event)=>void weekly(event.currentTarget.checked)} />{ui.groups.weeklySummary}</label>
     <small>{ui.groups.weeklyHelp}</small>{@render feedback('weekly')}
    </section>
    {#if manager}
     <details class="management"><summary>{ui.groups.manage}</summary><div class="stack">
      {#if owner}
       <label class="check"><input type="checkbox" checked={group.approveNewMembers} disabled={!!busy} onchange={(event)=>{const approveNewMembers=event.currentTarget.checked;event.currentTarget.checked=group!.approveNewMembers;void mutate('approval','/update',{approveNewMembers},ui.groups.approvalSaved)}} />{ui.groups.approveNew}</label>{@render feedback('approval')}
      {/if}
      {#if group.pending?.length}
       <section class="stack" aria-label={ui.groups.pendingLabel}><h3>{ui.groups.pendingHeading}</h3>
        {#each group.pending as pending (pending.id)}<div class="pending stack"><strong>{pending.name}</strong><div class="actions"><button class="secondary" disabled={!!busy} aria-label={ui.groups.approveMember(pending.name)} onclick={()=>void mutate(`pending:${pending.id}`,'/approve',{memberId:pending.id},ui.groups.memberApproved)}>{ui.groups.approve}</button><button class="text-button" disabled={!!busy} aria-label={ui.groups.declineMember(pending.name)} onclick={()=>void mutate(`pending:${pending.id}`,'/remove',{memberId:pending.id},ui.groups.requestDeclined)}>{ui.groups.decline}</button></div>{@render feedback(`pending:${pending.id}`)}</div>{/each}
       </section>
      {/if}
      {#each Object.keys(notes).filter(key=>key.startsWith('pending:')&&!group!.pending?.some(member=>key===`pending:${member.id}`)) as key (key)}{@render feedback(key)}{/each}
      <form class="stack" onsubmit={(event)=>{event.preventDefault();void mutate('invite','/invite',{expiresDays,maxUses},ui.groups.inviteReady)}}>
       <h3>{ui.groups.inviteHeading}</h3>
       <label>{ui.groups.inviteDays}<input type="number" min="1" max="90" step="1" required bind:value={expiresDays} /></label>
       <label>{ui.groups.inviteUses}<input type="number" min="1" max="100" step="1" required bind:value={maxUses} /></label>
       <button type="submit" disabled={!!busy}>{busy==='invite'?ui.groups.generating:ui.groups.generateInvite}</button>
       {@render feedback('invite')}
      </form>
      {#if invite}
       <div class="stack invite"><label>{ui.groups.inviteLink}<input bind:this={inviteInput} readonly value={new URL(invite.url,location.origin).href} onclick={(event)=>event.currentTarget.select()} /></label>
        <label>{ui.groups.inviteCode}<input readonly value={invite.code.replace(/-/g,'').match(/.{1,4}/g)?.join('-')||invite.code} onclick={(event)=>event.currentTarget.select()} /></label>
        <small>{ui.groups.inviteExpiry(invite.expiresAt,invite.maxUses)}</small>
        <button class="secondary" type="button" onclick={()=>void copyInvite()}>{ui.groups.copyInvite}</button>{@render feedback('copy')}
       </div>
      {/if}
      <small>{ui.groups.inviteHelp}</small>
      <button class="text-button" disabled={!!busy} onclick={()=>void mutate('revoke','/invite/revoke',{},ui.groups.inviteRevoked)}>{ui.groups.revokeInvite}</button>{@render feedback('revoke')}
     </div></details>
    {/if}
    <footer class="stack">
     <p class="privacy">{ui.groups.privacy(settings.groupShareTitles!==false)}</p>
     {#if owner}<small>{ui.groups.ownerLeaveHelp}</small><button class="text-button danger" disabled={!!busy} onclick={()=>{clearNote('confirm');confirmation={kind:'delete'}}}>{ui.groups.delete}</button>
     {:else}<button class="text-button" disabled={!!busy} onclick={()=>{clearNote('confirm');confirmation={kind:'leave'}}}>{ui.groups.leave}</button>{/if}
    </footer>
   </article>
  {/if}
 {/if}
</section>

{#if visible&&confirmation&&group}
 <Sheet title={confirmationTitle} close={busy?undefined:()=>{confirmation=null}}>
  <div class="group-confirmation stack">
   {#if confirmation.kind==='delete'}<p>{ui.groups.deleteDetail(group.name)}</p>
   {:else if confirmation.kind==='leave'}<p>{ui.groups.leaveDetail(group.name)}</p>
   {:else if confirmation.kind==='transfer'}<p>{ui.groups.transferDetail(confirmation.member?.name||'',group.name)}</p>
   {:else}<p>{ui.groups.removeDetail(confirmation.member?.name||'',group.name)}</p>{/if}
   <button disabled={!!busy} onclick={confirmAction}>{busy==='confirm'?ui.groups.saving:confirmation.kind==='delete'?ui.groups.delete:confirmation.kind==='leave'?ui.groups.leave:confirmation.kind==='transfer'?ui.groups.transfer:ui.groups.removeMember}</button>
   {@render feedback('confirm')}
   <button class="secondary" disabled={!!busy} onclick={()=>{confirmation=null}}>{ui.groups.cancel}</button>
  </div>
 </Sheet>
{/if}
