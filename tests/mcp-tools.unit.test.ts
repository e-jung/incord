import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {MCP_TOOL_SCHEMAS,runMcpTool,type McpToolDeps} from '../cloudflare/mcp-tools';
import {lookupReference} from '../src/content';
import {loadPassages} from '../src/passages';

function fixture(items:any[]=[],events:any[]=[],settings:any={}) {
 const paths:string[]=[];
 const fetch=vi.fn(async(request:Request|string|URL)=>{
  const url=new URL(typeof request==='string'?request:request instanceof URL?request.href:request.url,'https://test.invalid');paths.push(url.pathname);
  try{return new Response(await readFile(new URL('../public'+url.pathname,import.meta.url),'utf8'),{headers:{'Content-Type':'application/json'}})}catch{return new Response('',{status:404})}
 });
 const add=vi.fn(async(incoming:any[])=>({results:incoming.map(i=>({id:i.id,status:items.some(p=>p.id===i.id&&!p.deleted)?'exists':'added'}))}));
 const deps:McpToolDeps={assets:{fetch} as unknown as Fetcher,read:async()=>({items,events,settings}),add};
 return {deps,add,fetch,paths};
}
const run=(name:string,args:unknown={},f=fixture())=>runMcpTool(name,args,f.deps);
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()});

describe('MCP public-domain reference lookup',()=>{
 it.each(['BSB','KJV','WEB'])('uses actual %s bundled book text and matches frontend canonical IDs',async translation=>{
  const f=fixture();vi.stubGlobal('fetch',f.fetch);
  const out=await run('lookup_passage',{reference:'Jn 3:16–18',translation},f);
  const frontend=await lookupReference('Jn 3:16–18',translation);
  expect(out.reference).toBe('John 3:16–18');expect(out.count).toBe(3);
  expect(out.verses.map((v:any)=>v.id)).toEqual(frontend.map(v=>v.id));
  expect(out.text).toBe(frontend.map(v=>v.text).join(' '));
  expect(f.paths.every(p=>p===`/content/${translation.toLowerCase()}/jhn.json`)).toBe(true);
 });
 it.each(['John 0:1','John 3:0','John 22:1','John 3:37','John 3:18-16','John 4-3','John 3:16-4:99','Fake 1:1','John 3:16 garbage'])('rejects invalid boundary %s',async reference=>{
  await expect(run('lookup_passage',{reference})).rejects.toThrow();
 });
 it('supports Roman numerals, whole chapters, cross-chapter ranges and single-chapter aliases',async()=>{
  expect((await run('lookup_passage',{reference:'III John 2'})).verses[0].id).toBe('bsb-3jn-1-2');
  expect((await run('lookup_passage',{reference:'Ps 23'})).count).toBe(6);
  expect((await run('lookup_passage',{reference:'John 3:36-4:2'})).count).toBe(3);
 });
 it('rejects unsupported translations and reports unavailable assets',async()=>{
  await expect(run('lookup_passage',{reference:'John 3:16',translation:'NIV'})).rejects.toThrow();
  const f=fixture();f.fetch.mockResolvedValue(new Response('',{status:404}));
  await expect(run('lookup_passage',{reference:'John 3:16'},f)).rejects.toThrow('unavailable');
 });
});

describe('MCP additions',()=>{
 it('validates each input independently, normalizes ranges and assigns MCP origin',async()=>{
  const f=fixture();const out=await run('add_passages',{items:[{reference:'Jn 3:16-17'},{reference:'John 3:18-19',as_one_passage:true},{reference:'Nope 9:9'},{title:'My words',text:'Practice this.'},null]},f);
  expect(out.results.map((r:any)=>r.status)).toEqual(['added','added','invalid reference','added','invalid reference']);
  const added=f.add.mock.calls[0][0];
  expect(added.map((i:any)=>i.id).slice(0,3)).toEqual(['bsb-jhn-3-16','bsb-jhn-3-17','bsb-jhn-3-18--bsb-jhn-3-19']);
  expect(added.every((i:any)=>i.origin==='mcp')).toBe(true);expect(added[3].collection).toBe('personal');
  expect(added[2].title).toBe('John 3:18–19');expect(added[2]).not.toHaveProperty('learned');
 });
 it('accepts reference strings and top-level passage/collection options',async()=>{
  const f=fixture();const out=await run('add_passages',{items:['Romans 8:28-39',{reference:'Matthew 5:3-12',translation:'KJV'}],collection:'passages',as_one_passage:true},f);
  expect(out.results.map((r:any)=>r.status)).toEqual(['added','added']);const items=f.add.mock.calls[0][0];expect(items).toHaveLength(2);expect(items[0]).toMatchObject({id:'bsb-rom-8-28--bsb-rom-8-39',collection:'passages'});expect(items[1]).toMatchObject({id:'kjv-mat-5-3--kjv-mat-5-12',collection:'passages'});
 });
 it('limits requests to 50 inputs before touching storage',async()=>{
  const f=fixture();await expect(run('add_passages',{items:Array(51).fill({reference:'John 3:16'})},f)).rejects.toThrow();expect(f.add).not.toHaveBeenCalled();
  expect((await run('add_passages',{items:Array(50).fill({reference:'John 3:16'})},f)).results).toHaveLength(50);
  expect(f.add.mock.calls[0][0]).toHaveLength(1);
 });
 it('deterministically deduplicates custom text across calls and does not trust IDs or progress',async()=>{
  const f=fixture();const input={title:'  Remember  ',text:'  These exact words.  '};
  await run('add_passages',{items:[input,input]},f);await run('add_passages',{items:[input]},f);
  expect(f.add.mock.calls[0][0]).toHaveLength(1);expect(f.add.mock.calls[0][0][0].id).toMatch(/^own-mcp-[0-9a-f]{64}$/);
  expect(f.add.mock.calls[0][0][0].id).toBe(f.add.mock.calls[1][0][0].id);
  const bad=await run('add_passages',{items:[{...input,id:'bsb-jhn-3-16'},{...input,learned:true},{text:'no title'},{...input,translation:'ESV'}]},f);
  expect(bad.results.every((r:any)=>r.status==='invalid reference')).toBe(true);
 });
 it('matches all 17 curated passage IDs to the frontend and adds bundled document IDs',async()=>{
  const f=fixture();vi.stubGlobal('fetch',f.fetch);
  const catalog=await run('list_collections',{},f);
  const frontend=await loadPassages();
  await run('add_passages',{items:catalog.passages.items.map((p:any)=>({id:p.id}))},f);
  expect(f.add.mock.calls[0][0].map((i:any)=>i.id)).toEqual(frontend.map(i=>i.id));
  await run('add_passages',{items:[{id:'wsc-1'},{id:'nonexistent'}]},f);
  expect(f.add.mock.calls[1][0][0]).toMatchObject({id:'wsc-1',collection:'wsc',number:1,origin:'mcp'});
 });
 it('preserves DO statuses without returning arbitrary DO fields',async()=>{
  const f=fixture([{id:'bsb-jhn-3-16'}]);
  const out=await run('add_passages',{items:[{reference:'John 3:16'}]},f);
  expect(out.results[0].results).toEqual([{id:'bsb-jhn-3-16',status:'exists'}]);
  f.add.mockRejectedValue(Error('Library is full.'));
  expect((await run('add_passages',{items:[{reference:'John 3:16'}]},f)).results[0]).toMatchObject({status:'error',error:'Library is full.'});
 });
});

describe('MCP expansion limits',()=>{
 it.each(['BSB','KJV','WEB','ESV'])('caps each %s reference at 500 verses even when joined',async translation=>{
  const f=fixture();
  await expect(run('lookup_passage',{reference:'Genesis 1:1-20:4',translation},f)).resolves.toMatchObject({count:translation==='ESV'?1:500});
  await expect(run('lookup_passage',{reference:'Genesis 1:1-20:5',translation},f)).rejects.toThrow('500');
  const out=await run('add_passages',{items:[{reference:'Genesis 1:1-20:5',translation,as_one_passage:true},{reference:'John 3:16',translation}]},f);
  expect(out.results.map((r:any)=>r.status)).toEqual(['invalid reference','added']);
  expect(f.add.mock.calls[0][0]).toHaveLength(1);
 });
 it('rejects an overflowing input atomically while retaining valid inputs and remaining capacity',async()=>{
  const f=fixture();
  const out=await run('add_passages',{items:['Genesis 1:1-20:4',{reference:'Genesis 1:1-20:4',translation:'KJV'},'John 3:16']},f);
  expect(out.results.map((r:any)=>r.status)).toEqual(['added','added','invalid reference']);
  expect(out.results[2].reason).toContain('1000');expect(f.add.mock.calls[0][0]).toHaveLength(1000);
  const g=fixture();
  const partial=await run('add_passages',{items:['Genesis 1:1-20:3',{reference:'Genesis 1:1-20:3',translation:'KJV'},'John 3:16-18','John 3:16']},g);
  expect(partial.results.map((r:any)=>r.status)).toEqual(['added','added','invalid reference','added']);
  expect(g.add.mock.calls[0][0]).toHaveLength(999);
 });
 it('handles 50 oversized inputs as per-input errors without sending a huge backend call',async()=>{
  const f=fixture();const out=await run('add_passages',{items:Array(49).fill('Genesis 1-50').concat('John 3:16')},f);
  expect(out.results.filter((r:any)=>r.status==='invalid reference')).toHaveLength(49);
  expect(out.results[49].status).toBe('added');expect(f.add.mock.calls[0][0]).toHaveLength(1);
 });
});

describe('ESV reference-only safety and shared limits',()=>{
 it('uses only bundled BSB coordinates for ESV and always keeps one reference item',async()=>{
  const f=fixture();const out=await run('lookup_passage',{reference:'Jn 3:16-18',translation:'ESV'},f);
  expect(out.count).toBe(1);expect(out).not.toHaveProperty('text');expect(out.note).toContain('device');
  expect(out.verses.every((v:any)=>v.text==='')).toBe(true);
  await run('add_passages',{items:[{reference:'John 3:16-18',translation:'ESV'}]},f);
  expect(f.add.mock.calls[0][0][0]).toMatchObject({id:'esv-jhn-3-16--esv-jhn-3-18',reference:'John 3:16–18',text:'',esvVerseKeys:['jhn-3-16','jhn-3-17','jhn-3-18']});
  expect(f.paths).toEqual(['/content/bsb/jhn.json','/content/bsb/jhn.json']);
 });
 it.each(['John 99:1','John 3:99','John 3:18-16','Genesis 1-20','Jude 1-25'])('enforces shared coordinates and saving limits for %s',async reference=>{
  const f=fixture();await expect(run('lookup_passage',{reference,translation:'ESV'},f)).rejects.toThrow();expect(f.paths.every(p=>p.startsWith('/content/bsb/'))).toBe(true);
 });
 it.each([false,true])('matches device BSB omission handling regardless of as_one_passage=%s',async as_one_passage=>{
  const f=fixture();
  // Matthew 17:21 is an empty slot in the actual BSB asset, not a standalone passage.
  await expect(run('lookup_passage',{reference:'Matt 17:21',translation:'ESV'},f)).rejects.toThrow('valid verse');
  const out=await run('add_passages',{items:[{reference:'Matt 17:20-22',translation:'ESV',as_one_passage},{reference:'Matt 17:21-22',translation:'ESV',as_one_passage}]},f);
  expect(out.results.map((r:any)=>r.status)).toEqual(['added','invalid reference']);
  expect(f.add.mock.calls[0][0]).toEqual([expect.objectContaining({id:'esv-mat-17-20--esv-mat-17-22',reference:'Matthew 17:20–22',text:'',esvVerseKeys:['mat-17-20','mat-17-21','mat-17-22']})]);
  const lookup=await run('lookup_passage',{reference:'Matt 17:20-22',translation:'ESV'},f);
  expect(lookup.count).toBe(1);expect(lookup.verses[0].id).toBe('esv-mat-17-20--esv-mat-17-22');
  expect(f.paths.every(p=>p==='/content/bsb/mat.json')).toBe(true);
 });
 it('checks cumulative ESV half-book and 500-verse limits, with per-input failures',async()=>{
  const f=fixture();const out=await run('add_passages',{items:[{reference:'John 1-9',translation:'ESV',as_one_passage:true},{reference:'John 10',translation:'ESV',as_one_passage:true},{reference:'Romans 1-2',translation:'ESV',as_one_passage:true},{reference:'Romans 3',translation:'ESV',as_one_passage:true}]},f);
  expect(out.results.map((r:any)=>r.status)).toEqual(['added','invalid reference','added','invalid reference']);
  expect(out.results[3].reason).toContain('500');
 });
 it('strips legacy ESV text and untrusted extra fields in all library/daily outputs',async()=>{
  const f=fixture([{id:'esv-jhn-3-16',translation:'ESV',reference:'John 3:16',title:'SECRET',text:'SECRET',heading:'SECRET',payload:{text:'SECRET'},collection:'bible',learned:false},{id:'esv-bad',title:'SECRET',text:'SECRET',collection:'bible',learned:false}]);
  for(const name of ['list_library','get_due_today','get_progress'])expect(JSON.stringify(await run(name,{},f))).not.toContain('SECRET');
 });
});

describe('library, daily plan, progress, and collection discovery',()=>{
 it('lists live items with collection filtering, limits, and canonical order',async()=>{
  const f=fixture([{id:'b',title:'John 4:1',collection:'bible',translation:'BSB'},{id:'a',title:'John 3:16',collection:'bible',translation:'BSB'},{id:'deleted',deleted:true},{id:'own',title:'Own',collection:'personal'}]);
  expect(await run('list_library',{collection:'bible',limit:1},f)).toMatchObject({total:2,items:[{id:'a'}]});
  expect((await run('list_library',{},f)).items).toHaveLength(3);
  for(const limit of [0,1001,1.5])await expect(run('list_library',{limit},f)).rejects.toThrow();
  expect(MCP_TOOL_SCHEMAS.list_library.inputSchema.parse({}).limit).toBe(100);
 });
 it('honors timezone, completed new slots, reviews, and gentle return',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-14T01:00:00Z'));
  const items=[{id:'new',title:'John 3:16',learned:false},{id:'finished',title:'John 3:17',learned:true,due:'2026-11-20'},{id:'review',title:'John 3:18',learned:true,due:'2026-11-13'}];
  const f=fixture(items,[{itemId:'finished',at:'2026-11-14T00:00:00Z',mode:'learning'}],{timeZone:'America/Los_Angeles',newPerDay:1});
  expect(await run('get_due_today',{},f)).toMatchObject({date:'2026-11-13',count:1,items:[{id:'review'}]});
  const returning=fixture(Array.from({length:15},(_,i)=>({id:String(i),title:'Item',learned:true,due:'2026-11-01'})),[],{lastActive:'2026-11-01',timeZone:'UTC'});
  expect((await run('get_due_today',{},returning)).count).toBe(3);
 });
 it('reports timezone-aware streak and unique Monday-based weekly practice days',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-14T01:00:00Z'));
  const f=fixture([{id:'a',title:'Own',learned:true},{id:'b',title:'Own',learned:false},{id:'c',deleted:true}], [{at:'2026-11-14T00:00:00Z'},{at:'2026-11-14T00:30:00Z'}],{timeZone:'America/Los_Angeles',days:['2026-11-11','2026-11-12'],goal:4});
  expect(await run('get_progress',{},f)).toMatchObject({date:'2026-11-13',total:2,learned:1,learning:1,streak:3,weeklyRhythm:{goal:4,practicedDays:3}});
  expect((await run('get_progress',{},fixture([],[],{timeZone:'bad'}))).timeZone).toBe('UTC');
 });
 it('discovers starters, 17 Passages and all document metadata',async()=>{
  const out=await run('list_collections');expect(out.starters.length).toBeGreaterThan(0);expect(out.passages.itemCount).toBe(17);
  expect(out.documents.map((d:any)=>d.id)).toEqual(['wsc','heidelberg','apostles','nicene']);
  expect(out.documents[0].items[0]).toMatchObject({id:'wsc-1',number:1});
  expect(Object.keys(MCP_TOOL_SCHEMAS)).toHaveLength(6);
  await expect(run('delete_everything')).rejects.toThrow('Unknown');
 });
});
