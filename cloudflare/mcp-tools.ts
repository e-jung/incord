import {z} from 'zod';
import {topics} from '../shared/topics';
import books from '../public/content/books.json';
import {assertEsvLimit, esvReferenceKeys, isEsv} from '../shared/esv';
import {gentleCap} from '../src/engine/today';
import {RULES} from '../src/config/rules';

export type McpToolDeps = {assets: Fetcher; read: () => Promise<{items:any[];events:any[];settings:any}>; add: (items:any[]) => Promise<any>; feedback?: (input:{kind:'Idea'|'Problem'|'Other';message:string;contact?:string}) => Promise<any>};
type Item = {id:string;title:string;text:string;collection:string;translation:string;reference?:string;esvVerseKeys?:string[];[key:string]:any};
const MAX_REFERENCE_VERSES = 500;
const MAX_ADD_ITEMS = 1000;
const DEVICE_NOTE = 'ESV text is available only on your device. Open Incord to load and practice this passage.';
const translation = z.enum(['BSB','KJV','WEB','ESV']).default('BSB');
const passageInput = z.object({reference:z.string().trim().min(1).max(200).optional(), translation, as_one_passage:z.boolean().default(false).describe('Join non-ESV verses into one item. ESV always remains one reference-only item regardless of this option.'), title:z.string().trim().min(1).max(500).optional(), text:z.string().trim().min(1).max(100000).optional(), id:z.string().min(1).max(200).optional(), collection:z.string().trim().min(1).max(100).optional()}).strict();
export const MCP_TOOL_SCHEMAS = {
 send_feedback:{description:'Send an idea, problem or other feedback to the Incord team. Message must be 10–4000 characters. Include contact only if the user explicitly wants an email reply; never infer it from account details. Does not include library contents or device metadata. Available with any valid connection, including read-only access.',inputSchema:z.object({kind:z.enum(['Idea','Problem','Other']),message:z.string().trim().min(10).max(4000),contact:z.string().trim().max(254).refine(value=>!value||/^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/.test(value)&&!/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value),'Enter a valid reply email.').optional()}).strict()},
 lookup_passage:{description:'Look up a Bible reference in bundled BSB, KJV or WEB. Each reference is limited to 500 verses. ESV is one reference-only item validated against bundled BSB coordinates; no ESV text is fetched or returned.',inputSchema:z.object({reference:z.string().trim().min(1).max(200),translation}).strict()},
 add_passages:{description:'Add up to 50 Bible references or custom title/text items. Strings are Bible references; objects can specify reference and translation, or a catalog id. Each reference is limited to 500 verses and each call to 1000 expanded items. as_one_passage joins each range; otherwise each verse is one item. ESV always stays one reference-only passage regardless of as_one_passage. Existing items retain all edits and progress.',inputSchema:z.object({items:z.array(z.unknown().describe('A reference string, {reference, translation?}, {title, text}, or {id} from list_collections. Inputs are validated independently.')).min(1).max(50),collection:z.string().trim().min(1).max(100).optional(),as_one_passage:z.boolean().default(false).describe('Join non-ESV verses into one item. ESV always remains one reference-only item regardless of this option.')}).strict()},
 list_library:{description:'List live library items, optionally filtered by collection. Never returns ESV quotations.',inputSchema:z.object({collection:z.string().min(1).max(100).optional(),limit:z.number().int().min(1).max(1000).default(100)}).strict()},
 get_due_today:{description:'Get the daily learning/review plan in the account timezone, respecting new-item allowance and gentle return.',inputSchema:z.object({}).strict()},
 get_progress:{description:'Get library totals, practiced-day streak, and Monday-based weekly rhythm in the account timezone.',inputSchema:z.object({}).strict()},
 list_collections:{description:'List bundled starters, ten Topics, the 17 curated Passages, catechisms and creeds, including item IDs and available metadata.',inputSchema:z.object({}).strict()},
} as const;
const normalize = (s: string) => s.toLowerCase().replace(/\./g, '').replace(/\s/g, '');
const aliases = new Map<string, string>();
for (const book of books) {
  aliases.set(normalize(book.name), book.id);
  aliases.set(book.id, book.id);
}
const conventionalAliases: Record<string, string[]> = {
  gen: ['Ge', 'Gn'], exo: ['Ex', 'Exod'], lev: ['Le', 'Lv'], num: ['Nu', 'Nm'], deu: ['De', 'Dt', 'Deut'],
  jos: ['Josh'], jdg: ['Judg', 'Jdg'], rut: ['Ru'], '1sa': ['1 Sam', '1 Sa'], '2sa': ['2 Sam', '2 Sa'],
  '1ki': ['1 Kgs'], '2ki': ['2 Kgs'], '1ch': ['1 Chr', '1 Chron'], '2ch': ['2 Chr', '2 Chron'],
  ezr: ['Ezra'], neh: ['Ne'], est: ['Esth'], psa: ['Psalm', 'Ps', 'Pss'], pro: ['Pr', 'Prov'], ecc: ['Ec', 'Eccl'],
  sng: ['Song', 'Song of Songs', 'Song of Solomon', 'Canticles', 'SoS'], isa: ['Is'], jer: ['Je'], lam: ['La'],
  ezk: ['Ezek', 'Eze'], dan: ['Da', 'Dn'], hos: ['Ho'], jol: ['Jl'], amo: ['Am'], oba: ['Ob', 'Obad'],
  jon: ['Jnh'], mic: ['Mi'], nam: ['Nah', 'Na'], hab: ['Hb'], zep: ['Zeph'], hag: ['Hg'], zec: ['Zech'], mal: ['Ml'],
  mat: ['Mt', 'Matt'], mrk: ['Mk', 'Mar'], luk: ['Lk', 'Lu'], jhn: ['Jn', 'Joh'], act: ['Ac'], rom: ['Ro', 'Rm'],
  '1co': ['1 Cor'], '2co': ['2 Cor'], gal: ['Ga'], eph: ['Ep'], php: ['Phil', 'Php', 'Pp'], col: ['Co'],
  '1th': ['1 Thess', '1 Thes'], '2th': ['2 Thess', '2 Thes'], '1ti': ['1 Tim'], '2ti': ['2 Tim'], tit: ['Ti'],
  phm: ['Philem', 'Phlm'], heb: ['He'], jas: ['Jam', 'Jm'], '1pe': ['1 Pet', '1 Pt'], '2pe': ['2 Pet', '2 Pt'],
  '1jn': ['1 Jn'], '2jn': ['2 Jn'], '3jn': ['3 Jn'], jud: ['Jude'], rev: ['Re', 'Rv', 'Apocalypse'],
};
for (const [id, names] of Object.entries(conventionalAliases)) for (const name of names) aliases.set(normalize(name), id);

const passages = [
  {id: 'psalm-1', title: 'The way of the righteous', reference: 'Psalm 1', verseCount: 6},
  {id: 'psalm-23', title: 'The Lord is my shepherd', reference: 'Psalm 23', verseCount: 6},
  {id: 'psalm-100', title: 'A psalm of thanksgiving', reference: 'Psalm 100', verseCount: 5},
  {id: 'psalm-121', title: 'My help comes from the Lord', reference: 'Psalm 121', verseCount: 8},
  {id: 'isaiah-53-4-6', title: 'By His wounds', reference: 'Isaiah 53:4–6', verseCount: 3},
  {id: 'matthew-5-3-12', title: 'The Beatitudes', reference: 'Matthew 5:3–12', verseCount: 10},
  {id: 'matthew-6-9-13', title: 'The Lord’s Prayer', reference: 'Matthew 6:9–13', verseCount: 5},
  {id: 'john-1-1-5', title: 'In the beginning was the Word', reference: 'John 1:1–5', verseCount: 5},
  {id: 'john-15-5-8', title: 'The vine and the branches', reference: 'John 15:5–8', verseCount: 4},
  {id: 'romans-8-31-39', title: 'More than conquerors', reference: 'Romans 8:31–39', verseCount: 9},
  {id: 'romans-12-1-2', title: 'A living sacrifice', reference: 'Romans 12:1–2', verseCount: 2},
  {id: '1-corinthians-13-4-8', title: 'Love never fails', reference: '1 Corinthians 13:4–8', verseCount: 5},
  {id: 'ephesians-2-8-10', title: 'Saved by grace', reference: 'Ephesians 2:8–10', verseCount: 3},
  {id: 'philippians-2-5-11', title: 'The humility of Christ', reference: 'Philippians 2:5–11', verseCount: 7},
  {id: 'philippians-4-4-8', title: 'Rejoice in the Lord', reference: 'Philippians 4:4–8', verseCount: 5},
  {id: 'colossians-3-12-17', title: 'Clothe yourselves with love', reference: 'Colossians 3:12–17', verseCount: 6},
  {id: 'hebrews-12-1-2', title: 'Run with endurance', reference: 'Hebrews 12:1–2', verseCount: 2},
];

/** All content requests stay on the provided static-assets binding, never the public network. */
async function asset<T>(deps:McpToolDeps,path:string):Promise<T> {
 const response=await deps.assets.fetch(new Request('https://incord-assets.invalid/content/'+path));
 if(!response.ok)throw Error('Bundled content is unavailable.');
 return response.json() as Promise<T>;
}
function rangeTitle(first:Item,last:Item) {
 return first.title===last.title?first.title:first.title+'–'+(first.title.split(':')[0]===last.title.split(':')[0]?last.title.split(':').at(-1):last.title.split(' ').at(-1));
}
function joinVerses(verses:Item[]):Item {
 const first=verses[0],last=verses[verses.length-1];
 return {...first,id:first.id+(verses.length>1?'--'+last.id:''),title:rangeTitle(first,last),reference:rangeTitle(first,last),text:first.translation==='ESV'?'':verses.map(v=>v.text).join(' '),...(first.translation==='ESV'?{esvVerseKeys:verses.flatMap(v=>v.esvVerseKeys||[])}:{})};
}
async function lookup(reference:string,tr:string,deps:McpToolDeps):Promise<Item[]> {
 const input=reference.trim().replace(/[–—]/g,'-').replace(/^(III|II|I)\s+/i,(_,roman:string)=>`${roman.length} `);
 const match=/^(.+?)\s*(\d+)(?:[:.\s](\d+))?(?:\s*-\s*(\d+)(?:[:.\s](\d+))?)?$/.exec(input);
 if(!match)throw Error('Enter a Bible passage reference.');
 let [,name,first,verse,end,endVerse]=match;
 const id=aliases.get(normalize(name));
 if(!id)throw Error('Unknown Bible book.');
 if(['oba','phm','2jn','3jn','jud'].includes(id)&&!verse){verse=first;first='1'}
 const firstChapter=Number(first),lastChapter=Number(endVerse?end:verse?first:end??first);
 const firstVerse=verse?Number(verse):1,lastVerse=endVerse?Number(endVerse):verse?Number(end??verse):Infinity;
 if(firstChapter<1||firstVerse<1||lastChapter<firstChapter||lastVerse<1||(firstChapter===lastChapter&&lastVerse<firstVerse))throw Error('Enter a valid Bible passage range.');
 if(tr==='ESV') {
  // Match the device: BSB validates endpoints and skips its empty omission slots.
  // ESV stays one exact reference, never guessed verse-sized publisher passages.
  const coordinates=await lookup(reference,'BSB',deps);
  const first=coordinates[0],last=coordinates[coordinates.length-1];
  const canonical=rangeTitle(first,last);
  const item:Item={id:'esv-'+first.id.slice(4)+(coordinates.length>1?'--esv-'+last.id.slice(4):''),title:canonical,reference:canonical,text:'',collection:'bible',translation:'ESV',esvVerseKeys:esvReferenceKeys(canonical)};
  assertEsvLimit([item]);
  return [item];
 }
 const pack=await asset<{book:string;chapters:Record<string,Record<string,string>>;headings?:Record<string,string>}>(deps,`${tr.toLowerCase()}/${id}.json`);
 if(!pack.chapters[firstChapter]||!pack.chapters[lastChapter])throw Error('Enter a valid chapter.');
 if(verse&&(!pack.chapters[firstChapter][firstVerse]||!pack.chapters[lastChapter][lastVerse]))throw Error('Enter a valid verse.');
 const verses:Item[]=[];
 for(let c=firstChapter;c<=lastChapter;c++) {
  const chapter=pack.chapters[c];if(!chapter)throw Error('Enter a valid chapter.');
  for(const [v,text] of Object.entries(chapter)) {
   const n=Number(v);if((c===firstChapter&&n<firstVerse)||(c===lastChapter&&n>lastVerse)||!text)continue;
   if(verses.length>=MAX_REFERENCE_VERSES)throw Error('Each reference is limited to 500 verses.');
   verses.push({id:`${tr.toLowerCase()}-${id}-${c}-${v}`,title:`${id==='psa'?'Psalm':pack.book} ${c}:${v}`,text,collection:'bible',translation:tr,...(n===1&&pack.headings?.[c]?{heading:pack.headings[c]}:{})});
  }
 }
 if(!verses.length)throw Error('No verses found.');
 return verses;
}
/** Allowlist output fields: stale/malicious ESV records cannot smuggle quotations through extra properties. */
function publicItem(item:any):any {
 const fields=['id','title','text','collection','translation','reference','esvVerseKeys','number','lordsDay','part','parts','heading','step','learned','due','createdAt','learnedAt','updatedAt','origin'];
 if(isEsv(item)) {
  const safeReference=typeof item.reference==='string'?item.reference:typeof item.title==='string'?item.title:'';
  let reference='';let keys:string[]=[];
  try{keys=esvReferenceKeys(safeReference);reference=safeReference}catch{/* Untrusted legacy metadata must not expose a quotation. */}
  return {id:String(item.id),title:reference||'ESV passage',reference,esvVerseKeys:keys,text:'',collection:item.collection,translation:'ESV',step:item.step,learned:item.learned,due:item.due,note:DEVICE_NOTE};
 }
 return Object.fromEntries(fields.filter(k=>item[k]!==undefined).map(k=>[k,item[k]]));
}
async function collections(deps:McpToolDeps) {
 const [starters,documents]=await Promise.all([asset<any[]>(deps,'starters.json'),asset<any[]>(deps,'documents.json')]);
 return {topics:topics.map(topic=>({...topic,id:`topic-${topic.id}`,itemCount:topic.verseCount,translations:['BSB','KJV','WEB','ESV']})),starters:starters.map(({items,...meta})=>({...meta,itemCount:items.length,items:items.map(publicItem)})),passages:{id:'passages',title:'Passages',itemCount:passages.length,translations:['BSB','KJV','WEB','ESV'],items:passages},documents:documents.map(({items,...meta})=>({...meta,itemCount:items.length,items:items.map(publicItem)})),translations:['BSB','KJV','WEB','ESV'],esvNote:DEVICE_NOTE};
}
async function normalized(source:unknown,deps:McpToolDeps):Promise<Item[]> {
 const input=passageInput.parse(source);
 const modes=[!!input.reference,!!input.id,!!input.text].filter(Boolean).length;
 if(modes!==1)throw Error('Supply exactly one of reference, catalog id, or custom text.');
 let items:Item[];
 if(input.reference) {
  items=await lookup(input.reference,input.translation,deps);
  if(input.as_one_passage&&input.translation!=='ESV')items=[joinVerses(items)];
 }else if(input.id) {
  const passage=passages.find(p=>p.id===input.id),topic=topics.find(t=>`topic-${t.id}`===input.id);
  if(topic){items=[];for(const reference of topic.references){const verses=await lookup(reference,input.translation==='ESV'?'BSB':input.translation,deps);for(const verse of verses)items.push(...(input.translation==='ESV'?await lookup(verse.title,'ESV',deps):[verse]));}items=items.map(item=>({...item,collection:`topic-${topic.id}`}));}
  else if(passage){items=[joinVerses(await lookup(passage.reference,input.translation,deps))]}
  else {
   const catalog=await collections(deps);
   const found=[...catalog.starters,...catalog.documents].flatMap(c=>c.items).find(i=>i.id===input.id);
   if(!found)throw Error('Unknown catalog item ID.');items=[found];
  }
 }else {
  if(!input.title)throw Error('Custom text requires a title.');
  if(input.translation==='ESV')throw Error('ESV may only be added by reference.');
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([input.title,input.text])));
  const id='own-mcp-'+Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');
  items=[{id,title:input.title,text:input.text!,collection:'personal',translation:''}];
 }
 return items.map(item=>({...item,collection:input.collection||item.collection,origin:'mcp'}));
}
function zone(settings:any):string {try{new Intl.DateTimeFormat('en',{timeZone:settings?.timeZone});return settings?.timeZone||'UTC'}catch{return 'UTC'}}
function day(date:Date,timeZone:string) {return date.toLocaleDateString('en-CA',{timeZone})}
function shifted(date:string,days:number) {return new Date(Date.parse(date+'T12:00:00Z')+days*86400000).toISOString().slice(0,10)}
function daysBetween(a:string,b:string) {return Math.max(0,Math.round((Date.parse(a)-Date.parse(b))/86400000)||0)}
// Mirror dailyPlan without importing its browser-storage/content dependency graph.
function daily(items:any[],events:any[],settings:any,now:Date,timeZone:string) {
 const date=day(now,timeZone),newLimit=[1,2,3,5].includes(Number(settings.newPerDay))?Number(settings.newPerDay):3;
 const practiced=new Set(events.filter(e=>Number.isFinite(Date.parse(e.at))&&day(new Date(e.at),timeZone)===date&&e.mode!=='review').map(e=>e.itemId));
 const completed=items.filter(i=>i.learned&&practiced.has(i.id)).length;
 const reviews=items.filter(i=>i.learned&&Date.parse(i.due)<=now.getTime()).sort((a,b)=>Date.parse(a.due)-Date.parse(b.due)||canonicalCompare(a,b));
 const learning=items.filter(i=>!i.learned).sort(canonicalCompare).slice(0,Math.max(0,newLimit-completed));
 const daysAway=settings.lastActive?daysBetween(date,settings.lastActive):0,rampDay=settings.returnStart?daysBetween(date,settings.returnStart):7;
 const cap=daysAway>=7||(settings.returnStart&&rampDay<7)?gentleCap(settings.returnStart&&rampDay<7?7:daysAway,daysAway>=7&&rampDay>=7?0:rampDay,RULES.daily.normalCap):Infinity;
 return [...reviews,...learning].slice(0,cap);
}
function canonicalCompare(a:any,b:any):number {
 const key=(i:any):(string|number)[]=>{
  const m=/^(.+?) (\d+)(?::(\d+))?/.exec(i.title||'');
  const book=m?books.findIndex(b=>b.name.toLowerCase().replace(/s$/,'')===m[1].toLowerCase().replace(/s$/,'')):-1;
  if(book>=0&&(i.translation||i.collection==='bible'))return [0,book,Number(m![2]),Number(m![3]||0)];
  if(i.number){const order=['wsc','heidelberg','apostles','nicene','wlc','baptist','spurgeon','young-children'].indexOf(i.collection);return [1,order<0?99:order,i.number,i.part||0];}
  return [2,i.createdAt||new Date(i.updatedAt||0).toISOString(),i.order||0];
 };
 const x=key(a),y=key(b);for(let n=0;n<Math.max(x.length,y.length);n++)if(x[n]!==y[n])return typeof x[n]==='number'&&typeof y[n]==='number'?Number(x[n])-Number(y[n]):String(x[n]).localeCompare(String(y[n]));
 return a.id.localeCompare(b.id);
}

export async function runMcpTool(name:string,args:unknown,deps:McpToolDeps):Promise<any> {
 if(!Object.hasOwn(MCP_TOOL_SCHEMAS,name))throw Error('Unknown MCP tool.');
 const parsed:any=MCP_TOOL_SCHEMAS[name as keyof typeof MCP_TOOL_SCHEMAS].inputSchema.parse(args??{});
 if(name==='send_feedback'){if(!deps.feedback)throw Error('Feedback is unavailable.');return deps.feedback(parsed);}
 if(name==='lookup_passage') {
  const verses=await lookup(parsed.reference,parsed.translation,deps);
  return {reference:rangeTitle(verses[0],verses[verses.length-1]),translation:parsed.translation,count:verses.length,verses:verses.map(publicItem),...(parsed.translation==='ESV'?{note:DEVICE_NOTE}:{text:verses.map(v=>v.text).join(' ')})};
 }
 if(name==='list_collections')return collections(deps);
 if(name==='add_passages') {
  const results:any[]=[],pending:Item[]=[];
  const state=await deps.read();let prospective=state.items;
  for(const [index,input] of parsed.items.entries()) {
   try {
    const source=typeof input==='string'?{reference:input}:input;
    const options=source&&typeof source==='object'&&!Array.isArray(source)?{as_one_passage:parsed.as_one_passage,...(parsed.collection?{collection:parsed.collection}:{}),...source}:source;
    const items=await normalized(options,deps);
    if(pending.length+items.length>MAX_ADD_ITEMS)throw Error('Each add call is limited to 1000 expanded items. Use smaller batches.');
    const ids=new Set(items.map(i=>i.id));
    const candidate=[...prospective.filter(i=>!ids.has(i.id)||!i.deleted),...items.filter(i=>!prospective.some(p=>p.id===i.id&&!p.deleted))];
    assertEsvLimit(candidate);prospective=candidate;
    pending.push(...items);results.push({index,status:'pending',ids:items.map(i=>i.id)});
   }catch(error){results.push({index,status:'invalid reference',reason:error instanceof z.ZodError?'Invalid passage input.':error instanceof Error?error.message:'Invalid passage input.'})}
  }
  if(pending.length) {
   try {
    const unique=[...new Map(pending.map(i=>[i.id,i])).values()];
    const out=await deps.add(unique);
    // The UserDO owns insertion, timestamps, progress preservation, and final caps.
    const statuses=Array.isArray(out)?out:Array.isArray(out?.results)?out.results:[];
    for(const result of results)if(result.status==='pending'){
     result.results=result.ids.map((id:string)=>{
      const status=statuses.find((s:any)=>s.id===id);
      return {id,status:typeof status?.status==='string'?status.status:'processed',...(typeof (status?.reason??status?.error)==='string'?{reason:status.reason??status.error}:{})};
     });
     result.status=result.results.some((r:any)=>r.status==='invalid reference')?'invalid reference':result.results.some((r:any)=>r.status==='added')?'added':result.results.every((r:any)=>['already in library','exists'].includes(r.status))?'already in library':'processed';
    }
   }catch(error){for(const result of results)if(result.status==='pending'){result.status='error';result.error=error instanceof Error?error.message:'Unable to add passages.'}}
  }
  return {results};
 }
 const state=await deps.read(),items=state.items.filter(i=>!i.deleted).sort(canonicalCompare),settings=state.settings||{},now=new Date(),timeZone=zone(settings),date=day(now,timeZone);
 if(name==='list_library') {
  const filtered=items.filter(i=>!parsed.collection||i.collection===parsed.collection);
  return {items:filtered.slice(0,parsed.limit).map(publicItem),total:filtered.length,limit:parsed.limit};
 }
 if(name==='get_due_today') {
  const due=daily(items,state.events,settings,now,timeZone);
  return {date,timeZone,count:due.length,items:due.map(publicItem)};
 }
 const practiced=new Set<string>((settings.days||[]).filter((d:any)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)));
 for(const event of state.events)if(Number.isFinite(Date.parse(event.at)))practiced.add(day(new Date(event.at),timeZone));
 let streak=0,cursor=practiced.has(date)?date:shifted(date,-1);
 while(practiced.has(cursor)){streak++;cursor=shifted(cursor,-1)}
 const monday=shifted(date,-((new Date(date+'T12:00:00Z').getUTCDay()+6)%7));
 const days=Array.from({length:7},(_,i)=>{const date=shifted(monday,i);return {date,practiced:practiced.has(date)}});
 return {date,timeZone,total:items.length,learned:items.filter(i=>i.learned).length,learning:items.filter(i=>!i.learned).length,dueToday:daily(items,state.events,settings,now,timeZone).length,streak,weeklyRhythm:{goal:settings.goal||RULES.defaultRhythm,practicedDays:days.filter(d=>d.practiced&&d.date<=date).length,days}};
}
