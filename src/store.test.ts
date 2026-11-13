import {describe,it,expect} from 'vitest';
import {mergeItems,type Item} from './store';
const item=(id:string,updatedAt:number,title:string,deleted=false):Item=>({id,title,text:'Grace',collection:'personal',step:1,learned:false,due:'2026-01-01',updatedAt,deleted});
describe('offline reconciliation',()=>{
 it('retains local edits newer than a stale server snapshot',()=>{const a=item('a',10,'new');expect(mergeItems([a],[item('a',9,'old')])).toEqual([a])});
 it('merges unrelated items without losing queued local additions',()=>{const a=item('a',1,'a'),b=item('b',1,'b');expect(mergeItems([a],[b])).toEqual([a,b])});
 it('converges equal timestamp conflicts in either arrival order',()=>{const a=item('a',10,'a'),z=item('a',10,'z');expect(mergeItems([a],[z])).toEqual([z]);expect(mergeItems([z],[a])).toEqual([z])});
 it('retains tombstones so deleted items cannot be resurrected by stale clients',()=>{const dead=item('a',20,'Grace',true);expect(mergeItems([dead],[item('a',10,'Grace')])).toEqual([dead]);expect(mergeItems([item('a',10,'Grace')],[dead])).toEqual([dead])});
});
