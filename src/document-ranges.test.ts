import {describe, expect, it} from 'vitest';
import {documents} from './content';
import {documentNumbers, itemsInDocumentRange, nextDocumentRange} from './document-ranges';
const doc=(id:string)=>documents.find(d=>d.id===id)!;
const live=(items:{id:string}[])=>items.map(item=>({id:item.id}));
describe('document source-coordinate ranges',()=>{
 it('defaults to Q1–12 then Q13–24, not the first twelve again',()=>{
  const d=doc('wsc');
  expect(nextDocumentRange(d,[])).toEqual({start:1,end:12});
  expect(nextDocumentRange(d,live(d.items.slice(0,12)))).toEqual({start:13,end:24});
  expect(itemsInDocumentRange(d,'questions',{start:13,end:24}).map(i=>i.number)).toEqual(Array.from({length:12},(_,i)=>i+13));
 });
 it('keeps every canonical part of a long answer and treats a missing part as incomplete',()=>{
  const d=doc('wlc'), selected=itemsInDocumentRange(d,'questions',{start:99,end:99});
  expect(selected).toHaveLength(2);expect(selected.map(i=>i.part)).toEqual([1,2]);
  expect(selected).toEqual(d.items.filter(i=>i.number===99));
  expect(nextDocumentRange(d,live(d.items.filter(i=>(i.number||0)<99||i===selected[0]))).start).toBe(99);
  expect(documentNumbers(d)).toHaveLength(196);
 });
 it('defaults Heidelberg to a complete Lord’s Day block near twelve questions',()=>{
  const d=doc('heidelberg');
  expect(nextDocumentRange(d,[],'days')).toEqual({start:1,end:4});
  const first=itemsInDocumentRange(d,'days',{start:1,end:4});
  expect(first.map(i=>i.number)).toEqual(Array.from({length:11},(_,i)=>i+1));
  expect(nextDocumentRange(d,live(first),'days')).toEqual({start:5,end:7});
  const selected=itemsInDocumentRange(d,'days',{start:1,end:2});
  expect(selected.map(i=>i.number)).toEqual([1,2,3,4,5]);
 });
 it('handles inclusive endpoints, tail ranges, gaps, tombstones and fully added documents',()=>{
  const d=doc('wsc');
  expect(itemsInDocumentRange(d,'questions',{start:107,end:107})).toEqual([d.items.at(-1)]);
  expect(nextDocumentRange(d,live(d.items.slice(0,-1)))).toEqual({start:107,end:107});
  expect(nextDocumentRange(d,live(d.items.filter(i=>i.number!==5)))).toEqual({start:5,end:16});
  expect(nextDocumentRange(d,live(d.items).map((item,index)=>({...item,deleted:index===4})))).toEqual({start:5,end:16});
  expect(nextDocumentRange(d,live(d.items))).toEqual({start:1,end:12});
 });
 it('rejects reversed, fractional, blank and out-of-bounds ranges',()=>{
  for(const range of [{start:0,end:12},{start:1,end:108},{start:12,end:1},{start:1.5,end:3},{start:NaN,end:3}])expect(itemsInDocumentRange(doc('wsc'),'questions',range)).toEqual([]);
 });
 it('preserves every document, including all creed articles, in whole-document mode',()=>{
  for(const d of documents){expect(itemsInDocumentRange(d,'whole',{start:1,end:1})).toBe(d.items);expect(itemsInDocumentRange(d,'questions',{start:1,end:documentNumbers(d).at(-1)!})).toEqual(d.items)}
 });
});
