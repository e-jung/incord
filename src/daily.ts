import type {Item,ReviewEvent} from './store';
import {tokenize} from './engine';
/** Reviews are not charged to the daily new/learning allowance. Completed new
 * items still consume today's slots, so finishing one doesn't introduce another. */
export function dailyPlan(items:Item[],events:ReviewEvent[],date:string,newLimit=3,now=Date.now(),returnCap=Infinity):Item[]{
 const practiced=new Set(events.filter(e=>e.at.slice(0,10)===date&&(e as ReviewEvent & {mode?:string}).mode!=='review').map(e=>e.itemId));
 const completed=items.filter(i=>i.learned&&practiced.has(i.id)).length;
 const reviews=items.filter(i=>i.learned&&Date.parse(i.due)<=now);
 const learning=items.filter(i=>!i.learned).slice(0,Math.max(0,newLimit-completed));
 return [...reviews,...learning].slice(0,returnCap);
}
export function estimateMinutes(items:Item[]):number{return Math.max(1,Math.round(items.reduce((n,i)=>n+tokenize(i.text).length*(i.learned?1:5-i.step)*1.2,0)/60))}
