/** First-party aggregate counts only. Never pass account, request, text or exception data here. */
export const STATS_EVENTS = [
  'app_open','practice_start','peek','learned','own_text_added','welcome_back_shown','reminders_enabled','account_created','client_error',
  ...[1,2,3,4].flatMap(n => [`step_pass:${n}`,`step_fail:${n}`]),
  'i_know_this:pass','i_know_this:fail',...['again','hard','good','easy'].map(x=>`review:${x}`),
  ...['gospel','wsc-start','heidelberg-start','apostles-start','psalm23'].map(x=>`starter_added:${x}`),
  ...['bsb','kjv','web','esv'].map(x=>`translation_added:${x}`),
  ...['wsc','heidelberg','apostles','nicene'].map(x=>`doc_items_added:${x}`),
  'push_test:sent','push_test:failed',...['small','default','large','extra-large'].map(x=>`text_size:${x}`),
  ...['system','light','dark'].map(x=>`theme:${x}`),
] as const;
const allowed = new Set<string>(STATS_EVENTS);
export type StatsBatch = {token:string;events:string[]};
export function validateStatsBatch(value:unknown): StatsBatch | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string,unknown>;
  if (Object.keys(input).sort().join(',') !== 'events,token' || typeof input.token !== 'string' || !/^[a-f0-9]{32}$/.test(input.token) || !Array.isArray(input.events) || input.events.length < 1 || input.events.length > 50 || !input.events.every(x=>typeof x==='string' && allowed.has(x))) return null;
  return {token:input.token,events:[...input.events]};
}
export type StatsDay = { day:string; activeDevices:number; counters:Record<string,number> };
type TokenRate = {minute:number;count:number};
const dayOf = (now:number)=>new Date(now).toISOString().slice(0,10);
const DAY = 86400000;
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
/** One global instance (idFromName('stats')). Tokens are erased at UTC midnight;
 * local-day rotation makes uniques approximate. Weekly totals are device-days,
 * the sum of daily counts, NOT deduplicated weekly people. No cross-day linkage.
 */
export class StatsDO {
  constructor(private state:DurableObjectState) {}
  private async rollup(storage:DurableObjectTransaction|DurableObjectStorage, now:number) {
    const today=dayOf(now);
    // Separate token keys avoid the 128 KiB per-value limit on busy days.
    for (const [key] of await storage.list({prefix:'open:'})) {
      const day=key.slice(5);
      if(day>=today)continue;
      const keys=[...(await storage.list({prefix:'token:'+day+':'})).keys()];
      for(let i=0;i<keys.length;i+=128)await storage.delete(keys.slice(i,i+128));
      await storage.delete(key);
    }
    const cutoff=dayOf(now-29*DAY);
    for(const key of (await storage.list({prefix:'day:'})).keys()) if(key.slice(4)<cutoff) await storage.delete(key);
  }
  async alarm() {
    await this.state.storage.transaction(tx=>this.rollup(tx,Date.now()));
    await this.state.storage.setAlarm((Math.floor(Date.now()/DAY)+1)*DAY);
  }
  async fetch(request:Request):Promise<Response> {
    const path=new URL(request.url).pathname, now=Date.now(),day=dayOf(now),minute=Math.floor(now/60000);
    if(path==='/auth-limit') {
      const ok=await this.state.storage.transaction(async tx=>{
        const old=await tx.get<{minute:number;count:number}>('auth-limit');
        const next={minute,count:old?.minute===minute?old.count+1:1}; await tx.put('auth-limit',next); return next.count<=10;
      });
      return reply({ok},ok?200:429);
    }
    if(path==='/record' && request.method==='POST') {
      let input:unknown;try{input=await request.json()}catch{return reply({error:'Invalid batch'},400)}
      const batch=validateStatsBatch(input);if(!batch)return reply({error:'Invalid batch'},400);
      const accepted=await this.state.storage.transaction(async tx=>{
        await this.rollup(tx,now);
        const tokenKey='token:'+day+':'+batch.token;
        const rate=await tx.get<TokenRate>(tokenKey);
        const global=await tx.get<{minute:number;count:number}>('rate');
        if((rate?.minute===minute && rate.count>=20)||(global?.minute===minute && global.count>=1000))return false;
        const nextRate={minute,count:rate?.minute===minute?rate.count+1:1};
        const row=await tx.get<StatsDay>('day:'+day)||{day,activeDevices:0,counters:{}};
        for(const event of batch.events)row.counters[event]=(row.counters[event]||0)+1;
        if(!rate)row.activeDevices++;
        await tx.put(tokenKey,nextRate);await tx.put('open:'+day,true);await tx.put('day:'+day,row);
        await tx.put('rate',{minute,count:global?.minute===minute?global.count+1:1});return true;
      });
      await this.state.storage.setAlarm((Math.floor(now/DAY)+1)*DAY);
      return reply(accepted?{ok:true}:{error:'Too many batches'},accepted?200:429);
    }
    if(path==='/report' && request.method==='GET') {
      const days=await this.state.storage.transaction(async tx=>{
        await this.rollup(tx,now);const records=await tx.list<StatsDay>({prefix:'day:'});
        return Array.from({length:30},(_,i)=>{const date=dayOf(now-(29-i)*DAY);return records.get('day:'+date)||{day:date,activeDevices:0,counters:{}}});
      });return reply({days});
    }
    return reply({error:'Not found'},404);
  }
}
export interface StatsEnv { STATS:DurableObjectNamespace; STATS_TOKEN?:string; APP_ORIGIN?:string }
const stub=(env:StatsEnv)=>env.STATS.get(env.STATS.idFromName('stats'));
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
async function signature(secret:string,value:string) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(value)));
}
function equal(a:string,b:string) {let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0}
export async function signStatsCookie(secret:string,now=Date.now()) {const exp=String(Math.floor(now/1000)+86400);return exp+'.'+await signature(secret,'incord-stats:'+exp)}
export async function verifyStatsCookie(value:string|undefined,secret:string,now=Date.now()) {
  if(!value||!/^\d{10}\.[a-f0-9]{64}$/.test(value))return false;
  const [exp,sig]=value.split('.');return Number(exp)>now/1000 && Number(exp)<=now/1000+86400 && equal(sig,await signature(secret,'incord-stats:'+exp));
}
async function readLimited(request:Request,max:number) {
  const reader=request.body?.getReader();if(!reader)throw Error('Missing body');let value='',size=0;const decoder=new TextDecoder();
  while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();throw Error('Too large')}value+=decoder.decode(part.value,{stream:true})}return value+decoder.decode();
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const html=(content:string,status=200)=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Incord · Private counts</title><style>:root{color-scheme:light dark}body{font:16px system-ui;max-width:1000px;margin:auto;padding:24px;background:light-dark(#faf8f4,#201f1d);color:light-dark(#302e29,#eee9df)}h1,h2{font-family:Georgia,serif}section{margin:28px 0;padding:20px;border:1px solid #8886;border-radius:18px;overflow:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}td,th{text-align:left;padding:8px;border-bottom:1px solid #8884}input,button{font:inherit;padding:10px;border-radius:8px}svg{width:100%;height:70px;color:#8d9168}</style><main>${content}</main></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store, no-transform','Referrer-Policy':'same-origin','X-Robots-Tag':'noindex, nofollow','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"}});
export function renderStats(days:StatsDay[]) {
  const total=(event:string)=>days.reduce((n,d)=>n+(d.counters[event]||0),0);
  const group=(title:string,prefix:string)=>`<section><h2>${title}</h2><table><tr><th>Category</th><th>Count</th></tr>${STATS_EVENTS.filter(x=>x.startsWith(prefix)).sort((a,b)=>prefix==='starter_added:'?total(b)-total(a):0).map(event=>`<tr><td>${escape(event.slice(prefix.length))}</td><td>${total(event)}</td></tr>`).join('')}</table></section>`;
  const max=Math.max(1,...days.map(d=>d.activeDevices));const points=days.map((d,i)=>`${i*100/Math.max(1,days.length-1)},${60-d.activeDevices/max*55}`).join(' ');
  const sent=total('push_test:sent'),failed=total('push_test:failed');
  return `<h1>Incord · Private counts</h1><p>Last 30 UTC days · anonymous aggregate counts only.</p><p>Last 7 days: ${days.slice(-7).reduce((n,d)=>n+d.activeDevices,0)} active device-days (sum of daily devices; not deduplicated weekly people). Local-day token rotation makes daily devices approximate.</p><svg viewBox="0 0 100 65" preserveAspectRatio="none" role="img" aria-label="Daily active devices"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1"/></svg><section><h2>Daily activity</h2><table><tr><th>Date (UTC)</th><th>Devices</th><th>Practice starts</th><th>Learned</th><th>Client errors</th></tr>${days.map(d=>`<tr><td>${escape(d.day)}</td><td>${d.activeDevices}</td><td>${d.counters.practice_start||0}</td><td>${d.counters.learned||0}</td><td>${d.counters.client_error||0}</td></tr>`).join('')}</table></section>${group('Ladder passes','step_pass:')}${group('Ladder failures','step_fail:')}${group('Review grades','review:')}${group('Starters','starter_added:')}${group('Translation mix','translation_added:')}<section><h2>Reminders & push tests</h2><p>Reminders enabled: ${total('reminders_enabled')}</p><p>Push tests: ${sent} sent / ${failed} failed · success ${sent+failed?Math.round(sent/(sent+failed)*100)+'%':'—'}</p></section><form method="post" action="/stats/logout"><button>Sign out of stats</button></form>`;
}
/** Route /api/stats and /stats[/logout] before SPA fallback. Apply worker security headers.
 * No session or account is consulted. Never forward the original request into StatsDO.
 */
export async function handleStatsRequest(request:Request,env:StatsEnv):Promise<Response|null> {
  const url=new URL(request.url),path=url.pathname;if(path!=='/api/stats'&&path!=='/stats'&&path!=='/stats/logout')return null;
  const origin=url.origin;
  if(env.APP_ORIGIN && origin!==new URL(env.APP_ORIGIN).origin)return reply({error:'Wrong host'},403);
  if(!['GET','HEAD'].includes(request.method) && request.headers.get('Origin')!==origin)return reply({error:'Cross-origin write denied'},403);
  if(path==='/api/stats') {
    if(request.method!=='POST')return reply({error:'Method not allowed'},405);
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))return reply({error:'Expected JSON'},415);
    let batch:StatsBatch|null;try{batch=validateStatsBatch(JSON.parse(await readLimited(request,8192)))}catch{return reply({error:'Invalid batch'},400)}
    if(!batch)return reply({error:'Invalid batch'},400);
    return stub(env).fetch('https://stats/record',{method:'POST',body:JSON.stringify(batch)});
  }
  if(!env.STATS_TOKEN || env.STATS_TOKEN.length<32)return html('<h1>Stats are not configured</h1>',503);
  const cookie=(value:string,age:number)=>`incord_stats=${value}; HttpOnly; ${url.protocol==='https:'?'Secure; ':''}SameSite=Strict; Path=/stats; Max-Age=${age}`;
  if(path==='/stats/logout'&&request.method==='POST')return new Response(null,{status:303,headers:{Location:'/stats','Set-Cookie':cookie('',0),'Cache-Control':'no-store'}});
  const form=(invalid=false)=>html(`<h1>Private counts</h1>${invalid?'<p>Token not accepted. Try again later.</p>':''}<form method="post" action="/stats"><label>Stats token <input name="token" type="password" required autocomplete="off" maxlength="1024"></label> <button>View counts</button></form>`,invalid?401:200);
  if(request.method==='POST') {
    if(!(await stub(env).fetch('https://stats/auth-limit',{method:'POST'})).ok)return html('<h1>Try again in a minute</h1>',429);
    let token='';try{if(!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded'))return form(true);token=new URLSearchParams(await readLimited(request,4096)).get('token')||''}catch{return form(true)}
    if(!equal(await signature(env.STATS_TOKEN,token),await signature(env.STATS_TOKEN,env.STATS_TOKEN)))return form(true);
    return new Response(null,{status:303,headers:{Location:'/stats','Set-Cookie':cookie(await signStatsCookie(env.STATS_TOKEN),86400),'Cache-Control':'no-store'}});
  }
  if(request.method!=='GET')return reply({error:'Method not allowed'},405);
  const value=request.headers.get('Cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith('incord_stats='))?.slice(13);
  if(!await verifyStatsCookie(value,env.STATS_TOKEN))return form();
  const response=await stub(env).fetch('https://stats/report');if(!response.ok)return html('<h1>Counts unavailable</h1>',503);
  const report=await response.json<{days:StatsDay[]}>();return html(renderStats(report.days));
}
