import { test, expect, type Page } from '@playwright/test';
async function account(page:Page){if(page.url()==='about:blank')await page.goto('/');else await page.getByRole('navigation').getByRole('button',{name:'Today',exact:true}).click();await page.getByRole('button',{name:'Account settings',exact:true}).click()}
async function longPassage(page:Page){
 await page.getByRole('navigation').getByRole('button',{name:'Discover',exact:true}).click();
 await page.locator('.passage-cards').getByRole('button',{name:/Romans 8:31–39/}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Add to my library',exact:true}).click();
 await expect(page.getByRole('button',{name:/^Romans 8:31–39/})).toBeVisible();
 await page.getByRole('button',{name:/^Romans 8:31–39/}).click();
 await expect(page.getByLabel('Practice',{exact:true})).toBeFocused();
}
async function typeWords(page:Page,count:number){
 const words=await page.locator('[data-word]').allTextContents();
 for(const word of words.slice(0,count)){const key=Array.from(word.replace(/^[^\p{L}\p{N}]+/u,''))[0].toLowerCase();await page.keyboard.press(key)}
}
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({'CF-Connecting-IP':'product-'+crypto.randomUUID()})});
for(const width of [320,375,393])test(`Settings controls fit ${width}px including Safari time input`,async({page})=>{
 await page.setViewportSize({width,height:852});await account(page);
 const controls=page.locator('.settings-group input,.settings-group select,.settings-group textarea,.settings-group button');
 for(const control of await controls.all())if(await control.isVisible()){
  const box=await control.boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width+0.5);
 }
});
test('curated whole passage is one item and active word remains in viewport middle after sixty words',async({page})=>{
 await page.setViewportSize({width:393,height:852});await account(page);await longPassage(page);
 await typeWords(page,60);
 await expect.poll(async()=>{const b=await page.locator('[data-word="60"]').boundingBox();return b?b.y+b.height/2:0}).toBeGreaterThan(852*.25);
 await expect.poll(async()=>{const b=await page.locator('[data-word="60"]').boundingBox();return b?b.y+b.height/2:852}).toBeLessThan(852*.65);
 await expect(page.getByLabel('Practice',{exact:true})).toBeFocused();
 const saved=await page.evaluate(async()=>{const request=indexedDB.open('byheart',1);const db=await new Promise<IDBDatabase>(resolve=>request.onsuccess=()=>resolve(request.result));return new Promise<any>(resolve=>{const r=db.transaction('state').objectStore('state').get('current');r.onsuccess=()=>{resolve(r.result);db.close()}})});
 expect(saved.items.filter((i:any)=>!i.deleted)).toHaveLength(1);
});
test('feedback defaults off, toggles persist, enabled gestures invoke audio/vibration and off takes effect',async({page})=>{
 await page.addInitScript(()=>{
  const calls={audio:0,tick:0,vibrate:0};(window as any).__feedbackCalls=calls;
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:()=>{calls.vibrate++;return true}});
  (window as any).AudioContext=class {state='running';currentTime=0;destination={};constructor(){calls.audio++}resume(){return Promise.resolve()}close(){return Promise.resolve()}createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){calls.tick++},stop(){}}}createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}}}};
 });
 await account(page);await expect(page.getByLabel('Key sounds',{exact:true})).not.toBeChecked();await expect(page.getByLabel('Haptics',{exact:true})).not.toBeChecked();
 await longPassage(page);await typeWords(page,2);expect(await page.evaluate(()=>(window as any).__feedbackCalls)).toEqual({audio:0,tick:0,vibrate:0});
 await page.getByRole('button',{name:'Close practice',exact:true}).click();await account(page);
 await page.getByLabel('Key sounds',{exact:true}).check();await page.getByLabel('Haptics',{exact:true}).check();await page.reload();await account(page);
 await expect(page.getByLabel('Key sounds',{exact:true})).toBeChecked();await expect(page.getByLabel('Haptics',{exact:true})).toBeChecked();
 await longPassage(page);await typeWords(page,2);expect(await page.evaluate(()=>(window as any).__feedbackCalls)).toEqual({audio:1,tick:2,vibrate:2});
 await page.getByRole('button',{name:'Close practice',exact:true}).click();await account(page);await page.getByLabel('Key sounds',{exact:true}).uncheck();await page.getByLabel('Haptics',{exact:true}).uncheck();
 await page.evaluate(()=>Object.assign((window as any).__feedbackCalls,{audio:0,tick:0,vibrate:0}));
 await longPassage(page);await typeWords(page,2);expect(await page.evaluate(()=>(window as any).__feedbackCalls)).toEqual({audio:0,tick:0,vibrate:0});
});
test('iOS switch fallback is aria-hidden and retains physical keyboard focus',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'vibrate',{value:undefined,configurable:true});Object.defineProperty(navigator,'userAgent',{value:'iPhone OS 18',configurable:true})});
 await account(page);await page.getByLabel('Haptics',{exact:true}).check();await longPassage(page);await typeWords(page,3);
 await expect(page.locator('input[switch]')).toHaveCount(1);await expect(page.locator('input[switch]').locator('..')).toHaveAttribute('aria-hidden','true');await expect(page.getByLabel('Practice',{exact:true})).toBeFocused();await expect(page.locator('[data-word="3"]')).toHaveClass(/current/);
});
test('keyboard feedback preferences sync to a second signed-in device',async({page,browser,baseURL})=>{
 const enableVibrate=()=>{Object.defineProperty(navigator,'vibrate',{value:()=>true,configurable:true})};
 await page.addInitScript(enableVibrate);await account(page);
 await page.getByLabel('Key sounds',{exact:true}).check();await page.getByLabel('Haptics',{exact:true}).check();
 const email=`feedback-sync-${crypto.randomUUID()}@example.com`;
 async function signin(p:Page){await p.getByLabel('Email address',{exact:true}).fill(email);await p.getByRole('button',{name:'Email me a code',exact:true}).click();await expect(p.getByLabel('Six-digit code')).toBeVisible();const {code}=await(await p.request.get('/api/test/last-code?email='+encodeURIComponent(email))).json();await p.getByLabel('Six-digit code').fill(code);await expect(p.getByText('Signed in.',{exact:true})).toBeVisible()}
 await signin(page);await expect.poll(async()=>(await(await page.request.get('/api/export')).json()).settings).toMatchObject({keySounds:true,haptics:true});
 const context=await browser.newContext({baseURL,viewport:{width:393,height:852},extraHTTPHeaders:{'CF-Connecting-IP':'feedback-secondary-'+crypto.randomUUID()}});
 try{await context.addInitScript(enableVibrate);const second=await context.newPage();await account(second);await signin(second);await expect(second.getByLabel('Key sounds',{exact:true})).toBeChecked();await expect(second.getByLabel('Haptics',{exact:true})).toBeChecked()}finally{await context.close()}
});
test('passage added from a collection stays in that collection',async({page})=>{
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'Library',exact:true}).click();
 await page.locator('.covers').getByRole('button').filter({has:page.locator('b',{hasText:'The Gospel in 10 verses'})}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Add to my library',exact:true}).click();
 await page.getByRole('button',{name:'Add items',exact:true}).click();
 await page.locator('.passage-cards').getByRole('button',{name:/Psalm 23/}).click();await page.getByRole('dialog').getByRole('button',{name:'Add to my library',exact:true}).click();
 await expect(page.getByRole('heading',{name:'The Gospel in 10 verses',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/^Psalm 23:1–6/})).toBeVisible();
});
