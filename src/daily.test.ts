import {describe,it,expect} from 'vitest';
import {dailyPlan,estimateMinutes} from './daily';
import type {Item} from './store';
const item=(id:string,learned=false,step=1):Item=>({id,title:id,text:'One two three four five',collection:'personal',learned,step,due:'2026-01-01',updatedAt:0});
describe('P1-5 daily load',()=>{
 it('includes all due reviews and only three learning items by default',()=>{const items=[...Array.from({length:12},(_,i)=>item('review'+i,true)),...Array.from({length:10},(_,i)=>item('new'+i))];expect(dailyPlan(items,[],'2026-11-13')).toHaveLength(15)});
 it('completed learning still consumes a slot and return cap is applied before presentation',()=>{const items=[item('done',true),item('b'),item('c'),item('d')];const events=[{id:'e',itemId:'done',at:'2026-11-13T10:00:00Z',slips:0,hidden:1,grade:'Good'}];expect(dailyPlan(items,events,'2026-11-13',3).filter(i=>!i.learned)).toHaveLength(2);expect(dailyPlan(items,events,'2026-11-13',5,Date.now(),3)).toHaveLength(3)});
 it('estimates remaining ladder workload rather than item count',()=>{const long={...item('long'),text:Array(120).fill('word').join(' ')};expect(estimateMinutes([long])).toBe(10);expect(estimateMinutes([{...long,step:4}])).toBe(2);expect(estimateMinutes([item('short')])).toBe(1)});
});

it('P1-5 completion slots use the same local calendar day as Today',()=>{const items=[item('done',true),item('b'),item('c'),item('d')];const events=[{id:'e',itemId:'done',at:'2026-11-14T05:00:00Z',slips:0,hidden:1,grade:'Good'}];expect(dailyPlan(items,events,'2026-11-13',3,Date.now(),Infinity,'America/Los_Angeles').filter(i=>!i.learned)).toHaveLength(2)});
