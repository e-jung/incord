import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {dailyStatsToken,flushStats,installStats,localStatsDay,setStatsEnabled,statsEnabled,STATS_TOKEN_KEY,trackStats} from './stats';
let data:Map<string,string>;let fetcher:ReturnType<typeof vi.fn>;
beforeEach(()=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-13T10:00:00Z'));data=new Map();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>data.get(key)||null,setItem:(key:string,value:string)=>data.set(key,value),removeItem:(key:string)=>data.delete(key)});
 vi.stubGlobal('navigator',{doNotTrack:null,globalPrivacyControl:false});fetcher=vi.fn(async()=>new Response(null,{status:200}));vi.stubGlobal('fetch',fetcher);setStatsEnabled(false);setStatsEnabled(true);
});
afterEach(()=>{setStatsEnabled(false);vi.unstubAllGlobals();vi.useRealTimers()});
describe('Anonymous counter client',()=>{
 it('uses random 128-bit tokens stable only through the current local day',()=>{
  const now=new Date(2026,10,13,23,59);const first=dailyStatsToken(now);expect(first).toMatch(/^[a-f0-9]{32}$/);expect(dailyStatsToken(now)).toBe(first);
  const next=new Date(2026,10,14,0,1);expect(localStatsDay(next)).toBe('2026-11-14');const second=dailyStatsToken(next);expect(second).not.toBe(first);expect(data.get(STATS_TOKEN_KEY)).not.toContain(first!);
 });
 it('sends only token and whitelisted categories, never identifiers or content; same-origin without cookies',async()=>{
  trackStats('practice_start');trackStats('private verse text');trackStats('starter_added:private-id');await flushStats();expect(fetcher).toHaveBeenCalledOnce();
  const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('/api/stats');expect(init).toMatchObject({mode:'same-origin',credentials:'omit',referrerPolicy:'same-origin',keepalive:true});
  expect(JSON.parse(init.body as string)).toEqual({token:expect.stringMatching(/^[a-f0-9]{32}$/),events:['practice_start']});
 });
 it('caps batches at 50, flushes on idle, and does not retry failed sends',async()=>{
  for(let i=0;i<50;i++)trackStats('peek');expect(fetcher).toHaveBeenCalledOnce();expect(JSON.parse(fetcher.mock.calls[0][1].body).events).toHaveLength(50);
  trackStats('learned');await vi.advanceTimersByTimeAsync(5000);expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockRejectedValueOnce(Error('offline'));trackStats('peek');await flushStats();await flushStats();expect(fetcher).toHaveBeenCalledTimes(3);
 });
 it('clears queued counts and the token on opt out and honors GPC and all supported DNT forms',async()=>{
  trackStats('app_open');setStatsEnabled(false);await flushStats();expect(fetcher).not.toHaveBeenCalled();expect(data.has(STATS_TOKEN_KEY)).toBe(false);expect(statsEnabled()).toBe(false);
  for(const nav of [{globalPrivacyControl:true},{doNotTrack:'1'},{doNotTrack:'yes'}]){vi.stubGlobal('navigator',nav);setStatsEnabled(true);trackStats('peek');await flushStats();expect(statsEnabled()).toBe(false);expect(dailyStatsToken()).toBeNull()}
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('rechecks browser privacy immediately before a send',async()=>{
  trackStats('peek');vi.stubGlobal('navigator',{globalPrivacyControl:true});await flushStats();expect(fetcher).not.toHaveBeenCalled();expect(data.has(STATS_TOKEN_KEY)).toBe(false);
 });
 it('discards yesterday’s unsent queue when the local day changes',async()=>{
  trackStats('peek');vi.setSystemTime(new Date('2026-11-14T10:00:00Z'));await flushStats();expect(fetcher).not.toHaveBeenCalled();trackStats('learned');await flushStats();expect(JSON.parse(fetcher.mock.calls[0][1].body).events).toEqual(['learned']);
 });
 it('flushes on hidden visibility and removes lifecycle listeners on disposal',async()=>{
  const doc=Object.assign(new EventTarget(),{visibilityState:'visible'}),win=new EventTarget();vi.stubGlobal('document',doc);vi.stubGlobal('window',win);
  const dispose=installStats();doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();expect(fetcher).toHaveBeenCalledOnce();
  dispose();trackStats('learned');doc.dispatchEvent(new Event('visibilitychange'));expect(fetcher).toHaveBeenCalledOnce();
 });
 it('works without persistent browser storage and respects legacy window DNT',async()=>{
  vi.stubGlobal('localStorage',{getItem:()=>{throw Error('blocked')},setItem:()=>{throw Error('blocked')},removeItem:()=>{throw Error('blocked')}});
  trackStats('peek');await flushStats();expect(fetcher).toHaveBeenCalledOnce();vi.stubGlobal('window',{doNotTrack:'1'});trackStats('peek');await flushStats();expect(fetcher).toHaveBeenCalledOnce();
 });

});
