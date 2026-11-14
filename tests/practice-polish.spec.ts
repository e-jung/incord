import {test,expect,type Page,type Locator} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
const longQuestion=JSON.parse(readFileSync('public/content/documents.json','utf8')).find((d:any)=>d.id==='wlc').items.find((i:any)=>i.id==='wlc-79');
test.use({serviceWorkers:'block'});
async function tap(button:Locator){await button.waitFor();await button.page().evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const overlay=button.locator('xpath=following-sibling::input[contains(@class,"haptic-overlay")][1]');if(await overlay.count())await overlay.tap();else await button.click()}
// A fresh document in the same context verifies IndexedDB persistence without
// Linux MiniBrowser's repeated same-document-history reload crash.
async function reopen(page:Page){const context=page.context();await page.close();return context.newPage()}
async function stored(page:Page){return page.evaluate(async()=>{const r=indexedDB.open('byheart',1);const db=await new Promise<IDBDatabase>(resolve=>r.onsuccess=()=>resolve(r.result));return new Promise<any>(resolve=>{const q=db.transaction('state').objectStore('state').get('current');q.onsuccess=()=>{db.close();resolve(q.result)}})})}
async function start(page:Page,{step=4,learned=false,haptics=false,text='Peace I leave with you; My peace I give to you.',item=null as any}={}){
 await page.goto('/');await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
 await page.evaluate(async({step,learned,haptics,text,item})=>{const r=indexedDB.open('byheart',1);const db=await new Promise<IDBDatabase>(resolve=>r.onsuccess=()=>resolve(r.result));await new Promise<void>(resolve=>{const tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),r=store.get('current');r.onsuccess=()=>{const state=r.result;state.settings.haptics=haptics;state.items=[{id:'polish',title:'John 14:27',text,collection:'bible',translation:'BSB',...item,step,learned,due:new Date(0).toISOString(),updatedAt:Date.now(),createdAt:new Date().toISOString()}];store.put(state,'current')};tx.oncomplete=()=>resolve()});db.close()},{step,learned,haptics,text,item});
 await page.reload();await tap(page.locator('.row').filter({hasText:item?.title||'John 14:27'}));await expect(page.getByLabel('Practice',{exact:true})).toBeFocused();
}
async function finish(page:Page){for(const word of await page.locator('[data-word].current, [data-word].current ~ [data-word]').allTextContents())await page.keyboard.press(word.replace(/^[^\p{L}\p{N}]+/u,'')[0].toLowerCase())}
async function shot(page:Page,name:string,project:string){await mkdir('test-results/screens/practice-polish',{recursive:true});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`test-results/screens/practice-polish/${project}-${name}.png`,animations:'disabled'})}
test('typed letters, single-level undo, expiry, and saved events reflect only retained taps',async({page},info)=>{
 await start(page);await shot(page,'practice',info.project.name);
 await page.keyboard.press('z');await expect(page.locator('.typed-letter')).toHaveText('Z');await expect(page.locator('.typed-letter')).toHaveClass(/slip/);await expect(page.locator('[data-word="0"]')).toHaveClass(/slip/);await expect(page.locator('[aria-live="polite"]')).toContainText('Word 2 of 11');await shot(page,'slip',info.project.name);
 await tap(page.getByRole('button',{name:'Undo',exact:true}));await expect(page.locator('[data-word="0"]')).toHaveClass(/current/);await expect(page.locator('[data-word="0"]')).not.toHaveClass(/slip/);await expect(page.getByRole('button',{name:'Undo',exact:true})).toHaveCount(0);expect((await stored(page)).events).toHaveLength(0);
 await page.keyboard.press('p');await expect(page.locator('.typed-letter')).toHaveText('P');await expect(page.locator('.typed-letter')).not.toHaveClass(/slip/);const undoX=(await page.getByRole('button',{name:'Undo',exact:true}).boundingBox())!.x;await expect(page.locator('.typed-letter')).toHaveCount(0,{timeout:1500});expect((await page.getByRole('button',{name:'Undo',exact:true}).boundingBox())!.x).toBe(undoX);await expect(page.getByRole('button',{name:'Undo',exact:true})).toHaveCount(0,{timeout:3000});
 await page.keyboard.press('z');await page.keyboard.press('l');await tap(page.getByRole('button',{name:'Undo',exact:true}));await expect(page.locator('[data-word="2"]')).toHaveClass(/current/);await expect(page.locator('[data-word="1"]')).toHaveClass(/slip/);await page.getByRole('button',{name:'Restart step',exact:true}).click();
 await finish(page);await expect(page.locator('.learned')).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'Undo',exact:true})).toHaveCount(0);const state=await stored(page);expect(state.events).toHaveLength(1);expect(state.events[0].slips).toBe(0);
});
test('gap taps choose nearest key exactly once with and without native haptic overlays',async({page})=>{
 await page.context().addInitScript(()=>{Object.defineProperty(navigator,'vibrate',{value:undefined,configurable:true});Object.defineProperty(navigator,'userAgent',{value:'iPhone OS 27_2',configurable:true});(window as any).__keyClicks=0;document.addEventListener('click',e=>{if(e.target instanceof HTMLButtonElement&&e.target.classList.contains('key'))(window as any).__keyClicks++},true)});
 for(const haptics of [false,true]){
 if(haptics)page=await reopen(page);
 await start(page,{haptics});const row=page.locator('.keyrow').first(),keys=row.locator('button.key'),q=(await keys.nth(0).boundingBox())!,w=(await keys.nth(1).boundingBox())!,last=(await keys.last().boundingBox())!,box=(await row.boundingBox())!;
 expect(Math.abs(last.x+last.width-box.x-box.width)).toBeLessThan(1);expect(q.height).toBe(50);
 await page.touchscreen.tap(q.x+q.width+(w.x-q.x-q.width)*.2,q.y+q.height/2);await expect(page.locator('[data-word="1"]')).toHaveClass(/current/);await expect(page.locator('.typed-letter')).toHaveText('Q');expect(await page.evaluate(()=>(window as any).__keyClicks)).toBe(1);
 const bottom=page.locator('.keyrow').nth(2),edge=(await bottom.boundingBox())!;await page.touchscreen.tap(edge.x+1,edge.y+edge.height/2);await expect(page.locator('[data-word="2"]')).toHaveClass(/current/);await expect(page.locator('.typed-letter')).toHaveText('Z');expect(await page.evaluate(()=>(window as any).__keyClicks)).toBe(2);if(haptics)expect(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.classList.contains('haptic-overlay'),{x:edge.x+1,y:edge.y+edge.height/2})).toBe(true);
 await tap(page.getByRole('button',{name:'Close practice',exact:true}));await tap(page.getByRole('button',{name:'Leave',exact:true}));await page.evaluate(()=>(window as any).__keyClicks=0);
 }
});
test('masked text stays out of accessibility tree; Peek explains slips once and announces the word',async({page})=>{
 await start(page);await expect(page.locator('[data-hidden="true"]')).toHaveCount(11);for(const word of await page.locator('[data-hidden="true"]').all())await expect(word).toHaveAttribute('aria-hidden','true');await expect(page.locator('.peek-note')).toHaveCount(0);
 await tap(page.getByRole('button',{name:'Peek',exact:true}));await expect(page.locator('[data-word="0"]')).not.toHaveAttribute('aria-hidden','true');await expect(page.locator('[aria-live="polite"]')).toContainText('Peace');await expect(page.locator('.peek-note')).toContainText('Peek reveals the word; it counts as a slip.');await page.locator('.peek-note button').click();expect((await stored(page)).settings.peekNoteDismissed).toBe(true);
 page=await reopen(page);await page.goto('/');await tap(page.locator('.row').filter({hasText:'John 14:27'}));await tap(page.getByRole('button',{name:'Peek',exact:true}));await expect(page.locator('.peek-note')).toHaveCount(0);
});
test('close guard preserves current position, and result X or backdrop continues the session',async({page},info)=>{
 await start(page,{step:1});await page.keyboard.press('p');await tap(page.getByRole('button',{name:'Close practice',exact:true}));const guard=page.getByRole('dialog',{name:'Leave this practice?',exact:true});await expect(guard).toContainText("Your progress on this passage won't be saved.");await shot(page,'leave-guard',info.project.name);await guard.getByRole('button',{name:'Keep practicing',exact:true}).click();await expect(page.locator('[data-word="1"]')).toHaveClass(/current/);
 await finish(page);await expect(page.getByRole('dialog',{name:'Step 1 passed',exact:true})).toBeVisible();await shot(page,'result',info.project.name);await page.getByRole('button',{name:'Close dialog',exact:true}).click();await expect(page.locator('.prompt')).toContainText('Step 2 of 4');
 await finish(page);await page.getByRole('button',{name:'Dismiss dialog',exact:true}).click({position:{x:10,y:10}});await expect(page.locator('.prompt')).toContainText('Step 3 of 4');
 await page.keyboard.press('p');await tap(page.getByRole('button',{name:'Close practice',exact:true}));await page.getByRole('button',{name:'Leave',exact:true}).click();await expect(page.locator('.practice')).toHaveCount(0);expect((await stored(page)).events).toHaveLength(2);
});
for(const learned of [false,true])test(`successful ${learned?'review':'learning'} goes straight to one keepsake`,async({page},info)=>{
 await start(page,{learned});await finish(page);await expect(page.locator('.learned')).toBeVisible();await expect(page.getByRole('heading',{name:learned?'Reviewed':'Learned',exact:true})).toHaveCount(1);await expect(page.getByRole('dialog')).toHaveCount(0);await shot(page,learned?'review-keepsake':'learned',info.project.name);
});
test('first tap does not shift the verse and short screens retain 44px keys',async({page})=>{
 await start(page);const before=(await page.locator('.verse').boundingBox())!;await page.keyboard.press('p');const after=(await page.locator('.verse').boundingBox())!;expect(after.y).toBe(before.y);await page.setViewportSize({width:393,height:667});expect((await page.locator('button.key').first().boundingBox())!.height).toBe(44);
});

for(const viewport of [{width:393,height:852},{width:375,height:667}])for(const colorScheme of ['light','dark'] as const)test.describe(`${viewport.width}x${viewport.height} ${colorScheme} question`,()=>{
 test.use({viewport,colorScheme});
 test('long WLC prompt remains readable, expandable and stable while typing',async({page,browserName},info)=>{
  await page.addInitScript(()=>{Object.defineProperty(navigator,'vibrate',{value:undefined,configurable:true});Object.defineProperty(navigator,'userAgent',{value:'iPhone OS 27_2',configurable:true})});
  await start(page,{step:1,item:longQuestion,haptics:true});await page.evaluate(()=>document.fonts.ready);
  const verse=page.locator('.verse'),title=page.locator('.prompt-title'),before=(await verse.boundingBox())!;
  const words=await page.locator('[data-word]').allTextContents();
  await page.keyboard.press(words[0].replace(/^[^\p{L}\p{N}]+/u,'')[0].toLowerCase());
  expect((await verse.boundingBox())!.y).toBe(before.y);
  for(const word of words.slice(1,5))await page.keyboard.press(word.replace(/^[^\p{L}\p{N}]+/u,'')[0].toLowerCase());
  await expect(title).toHaveText(longQuestion.title);await expect(title).toHaveAttribute('aria-expanded','false');
  const scroller=page.locator('.prompt-title-scroll');
  const layout=await scroller.evaluate(el=>{const s=getComputedStyle(el);return {font:s.fontSize,weight:s.fontWeight,line:parseFloat(s.lineHeight),height:el.clientHeight,scroll:el.scrollHeight,overflow:s.overflowY,white:s.whiteSpace,ellipsis:s.textOverflow}});
  expect(layout.font).toBe('18px');expect(layout.weight).toBe('600');expect(layout.height).toBeLessThanOrEqual(layout.line*3+1);expect(layout.white).toBe('normal');expect(layout.ellipsis).not.toBe('ellipsis');expect(layout.overflow).toBe('auto');
  expect((await verse.boundingBox())!.height).toBeGreaterThan(100);const keys=(await page.locator('.keyboard').boundingBox())!;expect(keys.y+keys.height).toBeLessThanOrEqual(viewport.height);
  await shot(page,`question-${viewport.width}-${colorScheme}`,info.project.name);
  await expect(title.locator('xpath=following-sibling::input[contains(@class,"haptic-overlay")]')).toHaveCount(1);
  expect(await title.evaluate(el=>(el.nextElementSibling as HTMLElement).offsetParent===el.parentElement)).toBe(true);
  if(browserName==='chromium'&&layout.scroll>layout.height){
   const cdp=await page.context().newCDPSession(page),box=(await scroller.boundingBox())!;
   const x=box.x+box.width/2,y=box.y+box.height-8;
   await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
   for(let i=1;i<=12;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*(box.height-16)/12}]});await page.waitForTimeout(16)}
   await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
   await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  }
  await scroller.evaluate(el=>el.scrollTop=el.scrollHeight);if(layout.scroll>layout.height)expect(await scroller.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await tap(title);await expect(title).toHaveAttribute('aria-expanded','true');await shot(page,`question-expanded-${viewport.width}-${colorScheme}`,info.project.name);
  await tap(title);await page.locator('.practice').focus();
  for(const word of words.slice(5,35))await page.keyboard.press(word.replace(/^[^\p{L}\p{N}]+/u,'')[0].toLowerCase());
  await expect.poll(async()=>page.locator('[data-word="35"]').evaluate(el=>{const word=el.getBoundingClientRect(),view=el.closest('.verse')!.getBoundingClientRect();return word.top>=view.top&&word.bottom<=view.bottom})).toBe(true);
  await expect.poll(async()=>page.locator('[data-word="35"]').evaluate(el=>{const word=el.getBoundingClientRect(),view=el.closest('.verse')!.getBoundingClientRect();return Math.abs(word.top-view.top-view.height/3)})).toBeLessThan(8);
 });
});
test('successful background sync stays silent and clears only the recovered offline notice',async({page},info)=>{
 let fail=false,syncs=0;
 await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'silent-sync'}}}));
 await page.route('**/api/sync',route=>{syncs++;return route.fulfill(fail?{status:503,json:{error:'Unavailable'}}:{json:{items:[],events:[],settings:{}}})});
 await page.goto('/');await expect.poll(()=>syncs).toBeGreaterThan(0);await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();await expect(page.locator('.notice[role="status"]')).toHaveCount(0);await expect(page.getByText('All changes saved.',{exact:true})).toHaveCount(0);
 fail=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByText('Saved on this device. Sync will resume online.',{exact:true})).toBeVisible();
 fail=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(page.getByText('Saved on this device. Sync will resume online.',{exact:true})).toHaveCount(0);await expect(page.getByText('All changes saved.',{exact:true})).toHaveCount(0);await shot(page,'today-silent-sync',info.project.name);
});
