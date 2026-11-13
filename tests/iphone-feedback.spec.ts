import {test,expect,type Page} from '@playwright/test';
// Route-controlled ESV delays must reach Playwright, not a service-worker fetch.
// Offline-shell behavior is covered by the existing device/UI suites.
test.use({serviceWorkers:'block'});

const tab=async(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true}).click();
async function settings(page:Page){if(page.url()==='about:blank')await page.goto('/');else await tab(page,'Today');await page.getByRole('button',{name:'Account settings',exact:true}).click()}
async function signin(page:Page,email:string){
 await page.getByLabel('Email address',{exact:true}).fill(email);await page.getByRole('button',{name:'Email me a code',exact:true}).click();
 await expect(page.getByLabel('Six-digit code')).toBeVisible();const response=await page.request.get('/api/test/last-code?email='+encodeURIComponent(email));expect(response.ok()).toBe(true);
 await page.getByLabel('Six-digit code').fill((await response.json()).code);await expect(page.getByText('Signed in.',{exact:true})).toBeVisible();
}
function mockFeedback(){
 const calls={audio:0,tick:0,vibrate:0,resume:0};(window as any).__feedbackCalls=calls;
 Object.defineProperty(navigator,'vibrate',{configurable:true,value:()=>{calls.vibrate++;return true}});
 Object.defineProperty(navigator,'audioSession',{configurable:true,value:{type:'auto'}});
 (window as any).AudioContext=class {
  state='suspended';currentTime=0;sampleRate=48000;destination={};constructor(){calls.audio++}
  resume(){calls.resume++;this.state='running';return Promise.resolve()}close(){return Promise.resolve()}
  createBuffer(_channels:number,length:number){return {getChannelData:()=>new Float32Array(length)}}
  createBufferSource(){return {buffer:null,connect(){},disconnect(){},start(){},stop(){}}}
  createOscillator(){return {type:'',frequency:{value:0,setValueAtTime(){}},connect(){},disconnect(){},start(){calls.tick++},stop(){}}}
  createGain(){return {gain:{value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}}}
 };
}
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({'CF-Connecting-IP':'iphone-regression-'+crypto.randomUUID()})});
test('Test buttons give synchronous feedback with defaults OFF without enabling practice feedback',async({page})=>{
 await page.addInitScript(mockFeedback);await settings(page);
 await expect(page.getByLabel('Key sounds',{exact:true})).not.toBeChecked();await expect(page.getByLabel('Haptics',{exact:true})).not.toBeChecked();
 // Read counters in the same JS stack as click: deferring playback loses iOS user activation.
 const sound=await page.getByRole('button',{name:'Test sound',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();return {...(window as any).__feedbackCalls}});
 await expect(page.getByRole('status').filter({hasText:'Hear nothing?'})).toHaveText('Hear nothing? Your iPhone may be on Silent — key sounds follow the Silent switch, like the keyboard.');
 expect(sound.audio).toBe(1);expect(sound.resume).toBe(1);expect(sound.vibrate).toBe(0);expect(await page.evaluate(()=>(navigator as any).audioSession.type)).toBe('ambient');await expect.poll(()=>page.evaluate(()=>(window as any).__feedbackCalls.tick)).toBe(1);
 const haptic=await page.getByRole('button',{name:'Test haptic',exact:true}).evaluate(button=>{(button as HTMLButtonElement).click();return {...(window as any).__feedbackCalls}});
 expect(haptic.vibrate).toBe(1);expect(haptic.tick).toBe(1);
 await expect(page.getByLabel('Key sounds',{exact:true})).not.toBeChecked();await expect(page.getByLabel('Haptics',{exact:true})).not.toBeChecked();
 await tab(page,'Discover');await page.locator('.passage-cards').getByRole('button',{name:/Romans 8:31–39/}).click();await page.getByRole('dialog').getByRole('button',{name:'Add to my library',exact:true}).click();await page.getByRole('button',{name:/^Romans 8:31–39/}).click();
 const words=await page.locator('[data-word]').allTextContents();for(const word of words.slice(0,2))await page.keyboard.press(Array.from(word.replace(/^[^\p{L}\p{N}]+/u,''))[0].toLowerCase());
 expect(await page.evaluate(()=>(window as any).__feedbackCalls)).toEqual(haptic);
});
test('signed-in default translation syncs from Settings and the single Discover picker, with reference-only ESV passages',async({page,browser,baseURL})=>{
 const email=`translation-sync-${crypto.randomUUID()}@example.com`;
 const text='The LORD is my shepherd; I shall not want. He makes me lie down in green pastures.';
 const requests:string[]=[];const syncBodies:any[]=[];
 await page.route('**/api/esv?*',async route=>{requests.push(route.request().url());await route.fulfill({contentType:'text/plain',body:text})});
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/sync'&&request.method()==='POST')syncBodies.push(request.postDataJSON())});
 await settings(page);await signin(page,email);
 await expect(page.getByRole('combobox',{name:'Default translation',exact:true})).toHaveCount(1);
 await page.getByRole('combobox',{name:'Default translation',exact:true}).selectOption('KJV');
 await expect.poll(async()=>(await(await page.request.get('/api/export')).json()).settings).toMatchObject({defaultTranslation:'KJV',fieldUpdatedAt:{defaultTranslation:expect.any(Number)}});
 const firstClock=(await(await page.request.get('/api/export')).json()).settings.fieldUpdatedAt.defaultTranslation;expect(firstClock).toBeGreaterThan(0);await page.reload();await settings(page);await expect(page.getByRole('combobox',{name:'Default translation',exact:true})).toHaveValue('KJV');
 await tab(page,'Discover');await expect(page.getByRole('combobox',{name:'Default translation',exact:true})).toHaveCount(1);await expect(page.getByRole('combobox',{name:'Default translation',exact:true})).toHaveValue('KJV');
 const kjvCard=page.locator('.passage-cards').getByRole('button',{name:/Psalm 23/});await expect(kjvCard).toContainText('KJV');await kjvCard.click();await expect(page.getByRole('dialog').locator('.translation-badge')).toHaveText('KJV');await page.keyboard.press('Escape');
 await page.getByRole('combobox',{name:'Default translation',exact:true}).selectOption('ESV');
 await expect.poll(async()=>(await(await page.request.get('/api/export')).json()).settings.defaultTranslation).toBe('ESV');expect((await(await page.request.get('/api/export')).json()).settings.fieldUpdatedAt.defaultTranslation).toBeGreaterThan(firstClock);
 // KJV persistence was checked by reload above; ESV is checked on a reloaded
 // second device below, while this device exercises the live preference change.
 await expect(page.getByRole('combobox',{name:'Default translation',exact:true})).toHaveValue('ESV');
 const card=page.locator('.passage-cards').getByRole('button',{name:/Psalm 23/});await expect(card).toContainText('ESV');await card.click();
 const preview=page.getByRole('dialog');await expect(preview).toContainText(text);await expect(preview.getByRole('link',{name:'ESV',exact:true})).toBeVisible();
 await preview.getByRole('button',{name:'Add to my library',exact:true}).click();
 await expect(page.locator('.source-row').getByRole('link',{name:'ESV',exact:true})).toBeVisible();
 await expect.poll(async()=>((await(await page.request.get('/api/export')).json()).items as any[]).filter(i=>i.translation==='ESV').length).toBe(1);
 const exported=await(await page.request.get('/api/export')).json();const item=exported.items.find((i:any)=>i.translation==='ESV');expect(item.text).toBe('');expect(item.reference).toContain('Psalm 23');expect(item.esvVerseKeys).toHaveLength(6);
 expect(JSON.stringify(syncBodies)).not.toContain(text);for(const pushed of syncBodies.flatMap(body=>body.items||[]).filter((i:any)=>i.translation==='ESV'))expect(pushed.text).toBe('');expect(syncBodies.some(body=>body.items?.some((i:any)=>i.translation==='ESV'))).toBe(true);expect(requests.length).toBeGreaterThan(0);
 await page.getByRole('button',{name:/^Psalm 23:1[–-]6/}).click();await expect(page.locator('.practice .esv-attribution').getByRole('link',{name:'ESV',exact:true})).toBeVisible();await expect(page.locator('.practice')).toContainText(text);
 const context=await browser.newContext({baseURL,serviceWorkers:'block',viewport:{width:393,height:852},extraHTTPHeaders:{'CF-Connecting-IP':'translation-second-'+crypto.randomUUID()}});
 let release=()=>{};
 try{
  let secondFetches=0;const held=new Promise<void>(resolve=>release=resolve);await context.route('**/api/esv?*',async route=>{secondFetches++;await held;await route.fulfill({contentType:'text/plain',body:text})});const second=await context.newPage();await settings(second);await signin(second,email);
  await expect(second.getByRole('combobox',{name:'Default translation',exact:true})).toHaveValue('ESV');await second.reload();await settings(second);await expect(second.getByRole('combobox',{name:'Default translation',exact:true})).toHaveValue('ESV');
  await tab(second,'Discover');await expect(second.getByRole('combobox',{name:'Default translation',exact:true})).toHaveCount(1);await expect(second.getByRole('combobox',{name:'Default translation',exact:true})).toHaveValue('ESV');
  await tab(second,'Library');await second.getByRole('button',{name:/^Passages 0 of 1 learned/}).click();await expect(second.locator('.source-row').getByRole('link',{name:'ESV',exact:true})).toBeVisible();await second.getByRole('button',{name:/^Psalm 23:1[–-]6/}).click();await expect.poll(()=>secondFetches).toBe(1);
  // A remote preference must not cancel the in-flight ESV practice load.
  await page.getByRole('button',{name:'Close practice',exact:true}).click();await settings(page);await page.getByRole('combobox',{name:'Default translation',exact:true}).selectOption('KJV');await expect.poll(async()=>(await(await page.request.get('/api/export')).json()).settings.defaultTranslation).toBe('KJV');
  async function receivePreference(value:string){
   const synced=second.waitForResponse(response=>response.url().endsWith('/api/sync')&&response.request().method()==='POST');await second.evaluate(()=>window.dispatchEvent(new Event('focus')));await synced;
   await expect.poll(()=>second.evaluate(async()=>{const request=indexedDB.open('byheart',1);const db=await new Promise<IDBDatabase>(resolve=>request.onsuccess=()=>resolve(request.result));return new Promise<string>(resolve=>{const r=db.transaction('state').objectStore('state').get('current');r.onsuccess=()=>{resolve(r.result.settings.defaultTranslation);db.close()}})})).toBe(value);
  }
  await receivePreference('KJV');release();await expect(second.locator('.practice')).toContainText(text);await expect(second.locator('.practice .esv-attribution')).toContainText('ESV');
  // A remote translation update also leaves an unrelated catechism confirmation open.
  await second.getByRole('button',{name:'Close practice',exact:true}).click();await tab(second,'Discover');await second.getByRole('button',{name:'Catechisms & creeds',exact:true}).click();await second.locator('.document-cards').getByRole('button',{name:/^Westminster Larger Catechism/}).click();await second.getByRole('button',{name:'Whole document',exact:true}).click();await second.locator('.document-range-panel').getByRole('button',{name:/^Add \d+ items$/}).click();await expect(second.getByRole('dialog')).toBeVisible();
  await page.getByRole('combobox',{name:'Default translation',exact:true}).selectOption('WEB');await expect.poll(async()=>(await(await page.request.get('/api/export')).json()).settings.defaultTranslation).toBe('WEB');await receivePreference('WEB');await expect(second.getByRole('dialog')).toBeVisible();
  expect((await(await second.request.get('/api/export')).json()).items.find((i:any)=>i.id===item.id).text).toBe('');
 }finally{release();await context.close()}
});
