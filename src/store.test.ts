import {describe,it,expect} from 'vitest';
import {mergeItems,type Item} from './store';
const item=(id:string,updatedAt:number,title:string,deleted=false):Item=>({id,title,text:'Grace',collection:'personal',step:1,learned:false,due:'2026-01-01',updatedAt,deleted});
describe('offline reconciliation',()=>{
 it('retains local edits newer than a stale server snapshot',()=>{const a=item('a',10,'new');expect(mergeItems([a],[item('a',9,'old')])).toEqual([a])});
 it('merges unrelated items without losing queued local additions',()=>{const a=item('a',1,'a'),b=item('b',1,'b');expect(mergeItems([a],[b])).toEqual([a,b])});
 it('converges equal timestamp conflicts in either arrival order',()=>{const a=item('a',10,'a'),z=item('a',10,'z');expect(mergeItems([a],[z])).toEqual([z]);expect(mergeItems([z],[a])).toEqual([z])});
 it('retains tombstones so deleted items cannot be resurrected by stale clients',()=>{const dead=item('a',20,'Grace',true);expect(mergeItems([dead],[item('a',10,'Grace')])).toEqual([dead]);expect(mergeItems([item('a',10,'Grace')],[dead])).toEqual([dead])});
});

import {addItems,findLiveItem,sortItems,stampSettings,mergeSettings,defaults,emptyState,installReconnectSync} from './store';
import {vi,afterEach} from 'vitest';
afterEach(()=>vi.unstubAllGlobals());
describe('QA store regressions',()=>{
 it('P0-2 revives one tombstone and resets all progress',()=>{const old={...item('a',20,'John 3:16',true),step:4,learned:true,card:{due:'old'},learnedAt:'old'};const items=addItems([old],[item('a',10,'John 3:16')],undefined,15);expect(items).toHaveLength(1);expect(items[0]).toMatchObject({step:1,learned:false,deleted:false,updatedAt:21});expect(items[0].card).toBeUndefined();expect(findLiveItem([old],'a')).toBeUndefined();expect(findLiveItem(items,'a')).toBe(items[0]);expect(addItems(items,[old])).toHaveLength(1)});
 it('P0-2 repairs legacy duplicates using highest revision even in local input',()=>{expect(mergeItems([item('a',30,'new'),item('a',10,'old')],[])[0].title).toBe('new')});
 it('P1-18 does not stamp settings for practice-only saves',()=>{const before={...defaults,updatedAt:10};expect(stampSettings({...before,updatedAt:100},before,100).updatedAt).toBe(10)});
 it('P1-18 concurrent settings edits merge per field and converge',()=>{const before={...defaults,updatedAt:10};const a=stampSettings({...before,name:' Grace '},before,20),b=stampSettings({...before,theme:'dark'},before,30);expect(a.name).toBe('Grace');expect(a.fieldUpdatedAt?.name).toBe(20);expect(mergeSettings(a,b)).toMatchObject({name:'Grace',theme:'dark'});expect(mergeSettings(b,a)).toEqual(mergeSettings(a,b))});
 it('P1-18 preserves incoming remote clocks on persistence',()=>{const before={...defaults,updatedAt:10};const next={...before,name:'Grace',updatedAt:20,fieldUpdatedAt:{name:20}};expect(stampSettings(next,before,100).fieldUpdatedAt?.name).toBe(20)});
 it('P1-19 fresh account state contains no previous identity or practice',()=>{expect(emptyState()).toMatchObject({items:[],events:[],queue:[],account:null});const a=emptyState();a.settings.days.push('test');expect(emptyState().settings.days).toEqual([])});
 it('P2-20 sorts scripture canonically and document questions numerically',()=>{const items=['Romans 3:23','John 3:16','Psalm 23:2','Psalm 23:1','Q12','Q2'].map((title,n)=>item(String(n),1,title));expect(sortItems(items).map(x=>x.title)).toEqual(['Psalm 23:1','Psalm 23:2','John 3:16','Romans 3:23','Q2','Q12'])});
 it('P0-3 retries on reconnect/focus/visibility even without initial config',()=>{const win=new EventTarget(),doc=Object.assign(new EventTarget(),{visibilityState:'hidden'});vi.stubGlobal('window',win);vi.stubGlobal('document',doc);const sync=vi.fn(),cleanup=installReconnectSync(sync);win.dispatchEvent(new Event('online'));win.dispatchEvent(new Event('focus'));doc.dispatchEvent(new Event('visibilitychange'));expect(sync).toHaveBeenCalledTimes(2);doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));expect(sync).toHaveBeenCalledTimes(3);cleanup();win.dispatchEvent(new Event('online'));expect(sync).toHaveBeenCalledTimes(3)});
});

import {openStore,persist,cacheAccount,clearStore} from './store';
describe('P0-3 / P1-19 IndexedDB account boundary',()=>{
 it('round-trips cached identity offline and clears all account data on confirmed signout',async()=>{
  let saved:any;
  const database={transaction:()=>{const tx:any={objectStore:()=>({get:()=>{const request:any={};queueMicrotask(()=>{request.result=structuredClone(saved);request.onsuccess()});return request},put:(value:any)=>{saved=structuredClone(value)}})};queueMicrotask(()=>tx.oncomplete?.());return tx}};
  vi.stubGlobal('indexedDB',{open:()=>{const request:any={result:database};queueMicrotask(()=>request.onsuccess());return request}});
  const state=await openStore();state.items.push(item('a',1,'John 3:16'));state.events.push({id:'review',itemId:'a',at:'now',slips:0,hidden:0,grade:'Good'});state.settings.name='Grace';
  await cacheAccount(state,{id:'account-a',displayName:'Grace'});
  const offline=await openStore();expect(offline.account?.id).toBe('account-a');expect(offline.items).toHaveLength(1);expect(offline.settings.fieldUpdatedAt?.name).toBeGreaterThan(0);
  const cleared=await clearStore();expect(cleared).toMatchObject({items:[],events:[],queue:[],account:null});expect(await openStore()).toEqual(cleared);
  const local=await openStore();local.settings.name='Local';const settings=await persist(local);expect(settings.fieldUpdatedAt?.name).toBeGreaterThan(0);
 });
});
