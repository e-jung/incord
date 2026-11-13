import {afterEach,describe,expect,it,vi} from 'vitest';
import {StatsDO,STATS_EVENTS,validateStatsBatch,handleStatsRequest,signStatsCookie,verifyStatsCookie,type StatsEnv} from '../cloudflare/stats';
import {STATS_EVENTS as CLIENT_EVENTS} from '../src/stats';
function fixture() {
  const data=new Map<string,unknown>();let alarm=0;
  const storage={get:async(key:string)=>structuredClone(data.get(key)),put:async(key:string,value:unknown)=>{data.set(key,structuredClone(value))},delete:async(keys:string|string[])=>{for(const key of typeof keys==='string'?[keys]:keys)data.delete(key)},list:async({prefix}:{prefix:string})=>new Map([...data].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)])),setAlarm:async(value:number)=>{alarm=value},transaction:async<T>(cb:(tx:unknown)=>Promise<T>)=>cb(storage)};
  const object=new StatsDO({storage} as unknown as DurableObjectState);
  const env={STATS_TOKEN:'unit-test-stats-secret-more-than-32-chars',STATS:{idFromName:()=>'',get:()=>({fetch:(url:string,init?:RequestInit)=>object.fetch(new Request(url,init))})}} as unknown as StatsEnv;
  const record=(events=['app_open'],token='a'.repeat(32))=>object.fetch(new Request('https://internal/record',{method:'POST',body:JSON.stringify({token,events})}));
  return {data,object,env,record,alarm:()=>alarm};
}
const request=(path:string,body?:string,cookie?:string,origin='https://app.test')=>new Request('https://app.test'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':path==='/api/stats'?'application/json':'application/x-www-form-urlencoded',...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body})});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks()});
describe('Anonymous stats boundary',()=>{
 it('keeps the server and client categorical whitelist identical',()=>expect(CLIENT_EVENTS).toEqual(STATS_EVENTS));
 it('rejects identities, arbitrary categories, text, references and extra properties',()=>{
  const batch={token:'a'.repeat(32),events:['app_open']};expect(validateStatsBatch(batch)).toEqual(batch);
  for(const input of [null,[],{...batch,userId:'private'},{...batch,reference:'John 3:16'},{...batch,events:['starter_added:private-content']},{...batch,events:['own_text_added:secret']},{...batch,events:[{name:'app_open',text:'secret'}]},{...batch,events:Array(51).fill('peek')},{...batch,events:[]},{...batch,token:'user-id'}])expect(validateStatsBatch(input)).toBeNull();
 });
 it('aggregates counters and daily unique tokens; rolls up and deletes all token keys at midnight',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-13T23:59:00Z'));const f=fixture();
  await f.record(['app_open','practice_start','step_pass:1']);await f.record(['practice_start']);await f.record(['learned'],'b'.repeat(32));
  expect(f.alarm()).toBe(Date.parse('2026-11-14T00:00:00Z'));
  expect(f.data.get('day:2026-11-13')).toEqual({day:'2026-11-13',activeDevices:2,counters:{app_open:1,practice_start:2,'step_pass:1':1,learned:1}});
  vi.setSystemTime(new Date('2026-11-14T00:00:00Z'));await f.object.alarm();
  expect([...f.data.keys()].filter(key=>key.startsWith('tokens:'))).toEqual([]);expect(f.data.has('tokens:2026-11-13')).toBe(false);
  expect(f.data.get('day:2026-11-13')).toMatchObject({activeDevices:2});
  await f.record();const report=await (await f.object.fetch(new Request('https://internal/report'))).json<any>();expect(report.days).toHaveLength(30);expect(report.days.at(-1).activeDevices).toBe(1);
  vi.setSystemTime(new Date('2026-12-14T00:00:00Z'));await f.object.alarm();expect([...f.data.keys()].filter(key=>key.startsWith('day:'))).toEqual([]);
 });
 it('counts MCP tools without inventing a device token or active user',async()=>{
  const f=fixture();const aggregate=(event:string)=>f.object.fetch(new Request('https://internal/aggregate',{method:'POST',body:JSON.stringify({event})}));
  expect((await aggregate('mcp_tool:add_passages')).status).toBe(200);expect((await aggregate('mcp_tool:add_passages')).status).toBe(200);expect((await aggregate('private text')).status).toBe(400);
  const rows=[...f.data.values()] as any[];expect(rows.find(row=>row?.counters)).toMatchObject({activeDevices:0,counters:{'mcp_tool:add_passages':2}});expect([...f.data.keys()].some(key=>key.startsWith('token:'))).toBe(false);
 });
 it('limits batches per token and resets the limit each minute without storing IP or UA',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));const f=fixture();for(let i=0;i<20;i++)expect((await f.record()).status).toBe(200);
  expect((await f.record()).status).toBe(429);vi.advanceTimersByTime(60000);expect((await f.record()).status).toBe(200);
  expect(JSON.stringify([...f.data])).not.toMatch(/userId|userAgent|ipAddress/);
 });
 it('enforces same-origin bounded JSON transport, with no account dependency',async()=>{
  const f=fixture(),batch=JSON.stringify({token:'a'.repeat(32),events:['app_open']});
  expect((await handleStatsRequest(request('/api/stats',batch,undefined,'https://evil.test'),f.env))?.status).toBe(403);
  expect((await handleStatsRequest(request('/api/stats',batch),f.env))?.status).toBe(200);
  expect((await handleStatsRequest(request('/api/stats','x'.repeat(9000)),f.env))?.status).toBe(400);
  expect((await handleStatsRequest(request('/api/stats'),f.env))?.status).toBe(405);
  expect(await handleStatsRequest(request('/elsewhere'),f.env)).toBeNull();
 });
 it('signs an expiring cookie and rejects malformed, tampered, wrong-secret and expired cookies',async()=>{
  const now=Date.now(),secret='test-secret';const value=await signStatsCookie(secret,now);expect(await verifyStatsCookie(value,secret,now)).toBe(true);
  for(const bad of [undefined,'garbage',value+'a',value.replace(/^./,'0')])expect(await verifyStatsCookie(bad,secret,now)).toBe(false);
  expect(await verifyStatsCookie(value,'other',now)).toBe(false);expect(await verifyStatsCookie(value,secret,now+86400001)).toBe(false);
 });
 it('gates the private page, issues secure HttpOnly cookies, renders only aggregates and supports logout',async()=>{
  const f=fixture();await f.record();const login=await handleStatsRequest(request('/stats'),f.env);expect(await login!.text()).toContain('type="password"');
  expect((await handleStatsRequest(request('/stats','token=wrong'),f.env))?.status).toBe(401);
  expect((await handleStatsRequest(request('/stats?token='+f.env.STATS_TOKEN),f.env))?.headers.get('Set-Cookie')).toBeNull();
  const accepted=await handleStatsRequest(request('/stats','token='+f.env.STATS_TOKEN),f.env);expect(accepted?.status).toBe(303);
  const cookie=accepted!.headers.get('Set-Cookie')!;for(const flag of ['HttpOnly','Secure','SameSite=Strict','Path=/stats'])expect(cookie).toContain(flag);
  const page=await handleStatsRequest(request('/stats',undefined,cookie.split(';')[0]),f.env);const html=await page!.text();expect(html).toContain('Daily activity');expect(html).toContain('device-days');expect(html).not.toContain('a'.repeat(32));expect(html).not.toContain(f.env.STATS_TOKEN);
  const logout=await handleStatsRequest(request('/stats/logout','',cookie),f.env);expect(logout?.headers.get('Set-Cookie')).toContain('Max-Age=0');
 });
 it('rate limits token guesses and fails closed when the secret is absent',async()=>{
  const f=fixture();for(let i=0;i<10;i++)expect((await handleStatsRequest(request('/stats','token=wrong'),f.env))?.status).toBe(401);
  expect((await handleStatsRequest(request('/stats','token=wrong'),f.env))?.status).toBe(429);
  expect((await handleStatsRequest(request('/stats'),{...f.env,STATS_TOKEN:undefined}))?.status).toBe(503);
 });
});
