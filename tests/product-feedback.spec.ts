import { test, expect, type Page, type Locator } from '@playwright/test';
async function tap(button:Locator){await button.waitFor({state:'visible'});const overlay=button.locator('xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]');if(await overlay.count())await overlay.tap();else await button.click()}
async function account(page:Page){if(page.url()==='about:blank')await page.goto('/');else await tap(page.getByRole('navigation').getByRole('button',{name:'Today',exact:true}));await tap(page.getByRole('button',{name:'Account settings',exact:true}))}
async function longPassage(page:Page){
 await tap(page.getByRole('navigation').getByRole('button',{name:'Discover',exact:true}));
 await tap(page.locator('.passage-cards').getByRole('button',{name:/Romans 8:31–39/}));
 await tap(page.getByRole('dialog').getByRole('button',{name:'Add to my library',exact:true}));
 await expect(page.getByRole('button',{name:/^Romans 8:31–39/})).toBeVisible();
 await tap(page.getByRole('button',{name:/^Romans 8:31–39/}));
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
  Object.defineProperty(navigator,'vibrate',{configurable:true,value:()=>{calls.vibrate++;return true}});Object.defineProperty(navigator,'audioSession',{configurable:true,value:{type:'auto'}});
  (window as any).AudioContext=class {state='suspended';currentTime=0;sampleRate=48000;destination={};constructor(){calls.audio++}resume(){this.state='running';return Promise.resolve()}close(){return Promise.resolve()}createBuffer(_channels:number,length:number){return {length,getChannelData:()=>new Float32Array(length)}}decodeAudioData(){return Promise.resolve({length:1600})}createBufferSource(){return {buffer:null as {length:number}|null,playbackRate:{value:1},connect(){},disconnect(){},start(){if(this.buffer&&this.buffer.length>1)calls.tick++},stop(){}}}createOscillator(){return {frequency:{value:0},connect(){},disconnect(){},start(){},stop(){}}}createBiquadFilter(){return {type:'',frequency:{value:0},Q:{value:0},connect(){},disconnect(){}}}createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}}}};
 });
 await account(page);await expect(page.getByLabel('Key sounds',{exact:true})).not.toBeChecked();await expect(page.getByLabel('Haptics',{exact:true})).not.toBeChecked();
 await longPassage(page);await typeWords(page,2);expect(await page.evaluate(()=>(window as any).__feedbackCalls)).toEqual({audio:0,tick:0,vibrate:0});
 await tap(page.getByRole('button',{name:'Close practice',exact:true}));await account(page);
 await page.getByLabel('Key sounds',{exact:true}).check();await page.getByLabel('Haptics',{exact:true}).check();await page.reload();await account(page);
 await expect(page.getByLabel('Key sounds',{exact:true})).toBeChecked();await expect(page.getByLabel('Haptics',{exact:true})).toBeChecked();
 await longPassage(page);await page.evaluate(()=>(window as any).__feedbackCalls.vibrate=0);
 const enabledWords=await page.locator('[data-word]').allTextContents();for(const word of enabledWords.slice(0,2)){const letter=Array.from(word.replace(/^[^\p{L}\p{N}]+/u,''))[0].toUpperCase();await tap(page.locator('.keyboard').getByRole('button',{name:letter,exact:true}))}
 await expect.poll(()=>page.evaluate(()=>(window as any).__feedbackCalls.tick)).toBe(2);expect(await page.evaluate(()=>(window as any).__feedbackCalls)).toEqual({audio:1,tick:2,vibrate:2});
 await tap(page.getByRole('button',{name:'Close practice',exact:true}));await account(page);await page.getByLabel('Key sounds',{exact:true}).uncheck();await page.getByLabel('Haptics',{exact:true}).uncheck();
 await page.evaluate(()=>Object.assign((window as any).__feedbackCalls,{audio:0,tick:0,vibrate:0}));
 await longPassage(page);await typeWords(page,2);expect(await page.evaluate(()=>(window as any).__feedbackCalls)).toEqual({audio:0,tick:0,vibrate:0});
});
test('iOS direct switch taps dispatch once, preserve focus and physical input, and disappear when off',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'vibrate',{value:undefined,configurable:true});Object.defineProperty(navigator,'userAgent',{value:'iPhone OS 26_5',configurable:true});
  (window as any).__switchEvents=[];
  document.addEventListener('click',event=>{if(event.target instanceof HTMLInputElement&&event.target.hasAttribute('switch'))(window as any).__switchEvents.push({trusted:event.isTrusted})},true);
 });
 await account(page);
 const testButton=page.getByRole('button',{name:'Test haptic',exact:true});await expect(testButton.locator('xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]')).toHaveCount(0);await expect(testButton).toBeDisabled();
 await page.getByLabel('Haptics',{exact:true}).check();await expect(testButton.locator('xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]')).toHaveCount(1);await expect(testButton).toBeEnabled();await testButton.locator('xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]').tap();
 await longPassage(page);await page.evaluate(()=>(window as any).__switchEvents=[]);const region=page.getByLabel('Practice',{exact:true});
 const key=page.getByRole('button',{name:'F',exact:true}),overlay=key.locator('xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]');
 await expect(page.locator('.keyboard input[switch]')).toHaveCount(27);
 await expect(key.locator('input')).toHaveCount(0);
 await expect(overlay).toHaveAttribute('aria-hidden','true');await expect(overlay).toHaveAttribute('tabindex','-1');
 expect(await overlay.evaluate(input=>({opacity:getComputedStyle(input).opacity,display:getComputedStyle(input).display,appearance:getComputedStyle(input).appearance}))).toMatchObject({opacity:'0',appearance:'auto'});
 await overlay.tap();await expect(overlay).toBeChecked();await expect(page.locator('[data-word="1"]')).toHaveClass(/current/);await expect(region).toBeFocused();
 await page.getByRole('button',{name:'Peek',exact:true}).locator('xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]').tap();await expect(page.locator('[data-word="2"]')).toHaveClass(/current/);await expect(region).toBeFocused();
 await page.keyboard.press('w');await expect(page.locator('[data-word="3"]')).toHaveClass(/current/);await expect(region).toBeFocused();
 expect(await page.evaluate(()=>(window as any).__switchEvents)).toEqual([{trusted:true},{trusted:true}]);
 await tap(page.getByRole('button',{name:'Close practice',exact:true}));await account(page);await page.getByLabel('Haptics',{exact:true}).uncheck();await expect(page.locator('input[switch]')).toHaveCount(0);
 await longPassage(page);await expect(page.locator('input[switch]')).toHaveCount(0);
});
test('keyboard feedback edited AFTER signing in syncs field clocks and survives both devices reloading',async({page,browser,baseURL})=>{
 const enableVibrate=()=>{Object.defineProperty(navigator,'vibrate',{value:()=>true,configurable:true})};
 await page.addInitScript(enableVibrate);await account(page);
 const email=`feedback-sync-${crypto.randomUUID()}@example.com`;
 // Email and Google authenticate the same account/session/sync path; no live provider is needed.
 async function signin(p:Page){await p.getByLabel('Email address',{exact:true}).fill(email);await p.getByRole('button',{name:'Email me a code',exact:true}).click();await expect(p.getByLabel('Six-digit code')).toBeVisible();const {code}=await(await p.request.get('/api/test/last-code?email='+encodeURIComponent(email))).json();await p.getByLabel('Six-digit code').fill(code);await expect(p.getByText('Signed in.',{exact:true})).toBeVisible()}
 await signin(page);
 await page.getByLabel('Key sounds',{exact:true}).check();await page.getByLabel('Haptics',{exact:true}).check();
 await expect.poll(async()=>(await(await page.request.get('/api/export')).json()).settings).toMatchObject({keySounds:true,haptics:true,fieldUpdatedAt:{keySounds:expect.any(Number),haptics:expect.any(Number)}});
 const settings=(await(await page.request.get('/api/export')).json()).settings;
 expect(settings.fieldUpdatedAt.keySounds).toBeGreaterThan(0);expect(settings.fieldUpdatedAt.haptics).toBeGreaterThan(0);
 await page.reload();await account(page);await expect(page.getByLabel('Key sounds',{exact:true})).toBeChecked();await expect(page.getByLabel('Haptics',{exact:true})).toBeChecked();
 const context=await browser.newContext({baseURL,viewport:{width:393,height:852},extraHTTPHeaders:{'CF-Connecting-IP':'feedback-secondary-'+crypto.randomUUID()}});
 try{await context.addInitScript(enableVibrate);const second=await context.newPage();await account(second);await signin(second);
  for(const reload of [false,true]){if(reload){await second.reload();await account(second)}await expect(second.getByLabel('Key sounds',{exact:true})).toBeChecked();await expect(second.getByLabel('Haptics',{exact:true})).toBeChecked()}
  await expect.poll(async()=>(await(await second.request.get('/api/export')).json()).settings.fieldUpdatedAt).toMatchObject({keySounds:settings.fieldUpdatedAt.keySounds,haptics:settings.fieldUpdatedAt.haptics});
 }finally{await context.close()}
});
test('passage added from a collection stays in that collection',async({page})=>{
 await page.goto('/');await tap(page.getByRole('navigation').getByRole('button',{name:'Discover',exact:true}));
 await page.locator('.featured-cards').getByRole('button').filter({has:page.locator('b',{hasText:'The Gospel in 10 verses'})}).click();
 await tap(page.getByRole('dialog').getByRole('button',{name:'Add to my library',exact:true}));
 await page.getByRole('button',{name:'Add items',exact:true}).click();
 await page.locator('.passage-cards').getByRole('button',{name:/Psalm 23/}).click();await tap(page.getByRole('dialog').getByRole('button',{name:'Add to my library',exact:true}));
 await expect(page.getByRole('heading',{name:'The Gospel in 10 verses',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/^Psalm 23:1–6/})).toBeVisible();
});

test('standalone haptics lab exposes five independent native-switch comparisons without inline assets',async({page})=>{
 await page.goto('/haptics-lab.html');
 await expect(page.getByRole('heading',{name:'Native switch haptics lab',exact:true})).toBeVisible();
 await expect(page.locator('input[switch]')).toHaveCount(5);
 await expect(page.locator('script:not([src]),[style],[onclick]')).toHaveCount(0);
 for(const name of ['a','b','c','d','e']){
  await page.locator(name==='d'?'.label-overlay':`#test-${name}`).tap();
  await expect(page.locator(`#count-${name}`)).toHaveText('1');
  await expect(page.locator(`#test-${name}`)).toBeChecked();
 }
 await expect(page.locator('#test-b').locator('..').locator(':scope > button')).toHaveCount(1);
 await expect(page.locator('#test-c').locator('..')).toHaveJSProperty('tagName','BUTTON');
});
