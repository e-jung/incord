import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
async function tab(page:Page,name:string){await page.getByRole('navigation').getByRole('button',{name,exact:true}).click()}
async function shot(page:Page,project:string,name:string){await mkdir('test-results/screens/qa6',{recursive:true});await page.screenshot({path:`test-results/screens/qa6/${project}-${name}.png`})}
test('WSC Q1 entry after library scroll and both steps stay inside standalone viewport',async({page},info)=>{
 await page.addInitScript(()=>Object.defineProperty(navigator,'standalone',{value:true}));
 await page.goto('/');await tab(page,'Discover');await page.getByRole('button',{name:'Catechisms & creeds',exact:true}).click();
 await page.locator('.document-cards').getByRole('button',{name:/^Westminster Shorter Catechism/}).click();
 await page.locator('.document-range-panel').getByRole('button',{name:'Add 12 items',exact:true}).click();
 await tab(page,'Library');await page.getByRole('button',{name:/Westminster Shorter Catechism 0 of 12 learned/}).click();
 await page.evaluate(()=>window.scrollTo(0,400));
 expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(0);
 await page.getByRole('button').filter({has:page.locator('b',{hasText:"What is the chief end of man?"})}).click();
 const title=page.locator('.prompt h1');await expect(title).toBeVisible();
 for(let step=1;step<=2;step++){
  await expect(page.getByText(new RegExp(`^Step ${step} of 4`))).toBeVisible();
  const geometry=await page.evaluate(()=>{const probe=document.createElement('div');probe.style.paddingTop='env(safe-area-inset-top)';document.body.append(probe);const safe=parseFloat(getComputedStyle(probe).paddingTop)||0;probe.remove();const practice=document.querySelector('.practice')!,title=practice.querySelector('h1')!.getBoundingClientRect();return {safe,top:title.top,bottom:title.bottom,height:innerHeight,position:getComputedStyle(document.querySelector('main')!).position,padding:parseFloat(getComputedStyle(practice).paddingTop)}});
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.safe);expect(geometry.bottom).toBeLessThan(geometry.height);expect(geometry.position).toBe('fixed');expect(geometry.padding).toBeGreaterThanOrEqual(16+geometry.safe);
  await info.attach(`step-${step}-geometry`,{body:JSON.stringify(geometry),contentType:'application/json'});
  expect(await page.evaluate(()=>scrollY)).toBe(0);
  if(step===1)await shot(page,info.project.name,'practice-step1');
  const words=await page.locator('[data-word]').allTextContents();
  for(const word of words)await page.keyboard.press(word.replace(/^[^\p{L}\p{N}]+/u,'')[0].toLowerCase());
  await page.getByRole('dialog').getByRole('button',{name:'Continue',exact:true}).click();
 }
});
test('text sizes persist and extra large keeps 375x667 practice usable',async({page},info)=>{
 await page.setViewportSize({width:375,height:667});await page.goto('/');
 await page.getByRole('button',{name:'Account settings',exact:true}).click();
 for(const size of ['small','default','large','extra-large']){await page.getByRole('combobox',{name:'Text size',exact:true}).selectOption(size);await shot(page,info.project.name,`text-${size}`)}
 await page.reload();await page.getByRole('button',{name:'Account settings',exact:true}).click();await expect(page.getByRole('combobox',{name:'Text size',exact:true})).toHaveValue('extra-large');
 await tab(page,'Discover');await page.getByRole('button',{name:'Your text',exact:true}).click();await page.getByLabel('Title or question').fill('A question that wraps across more than one line');await page.getByLabel('Text to remember').fill('Grace and peace be with you always.');await page.getByRole('button',{name:'Add your text',exact:true}).click();await page.getByRole('button').filter({has:page.locator('b',{hasText:'A question that wraps'})}).click();
 await expect(page.locator('.practice')).toBeVisible();
 const layout=await page.evaluate(()=>{const verse=document.querySelector('.verse')!.getBoundingClientRect(),keyboard=document.querySelector('.keyboard')!.getBoundingClientRect(),title=document.querySelector('.prompt h1')!.getBoundingClientRect();return {verse:verse.height,keyboard:keyboard.bottom,title:title.top,width:document.documentElement.scrollWidth}});
 expect(layout.verse).toBeGreaterThan(80);expect(layout.keyboard).toBeLessThanOrEqual(667);expect(layout.title).toBeGreaterThanOrEqual(0);expect(layout.width).toBe(375);
 await shot(page,info.project.name,'extra-large-practice');
 await page.locator('.practice').focus();await page.keyboard.press('g');await expect(page.locator('[data-word="0"]')).toHaveClass(/done/);
 await expect(page.getByRole('button',{name:'G',exact:true})).toHaveAttribute('aria-label','G');
});
test.describe('notification fixtures',()=>{
 test.use({serviceWorkers:'block'});
for(const state of ['on','missing','denied'] as const)test(`Account notification health: ${state}`,async({page},info)=>{
 let subscribed=state==='on';
 await page.route('**/api/me',route=>route.fulfill({json:{user:{id:'device-fixture'}}}));
 await page.route('**/api/sync',route=>route.fulfill({json:{items:[],events:[],settings:{}}}));
 await page.route('**/api/push/status*',route=>route.fulfill({json:{subscribed,results:[{time:Date.now(),host:'web.push.apple.com',status:403,reason:'{"reason":"BadJwtToken"}'}]}}));
 await page.route('**/api/push/subscribe',route=>{subscribed=true;return route.fulfill({json:{ok:true}})});
 await page.route('**/api/push/test',route=>route.fulfill({json:{sent:0,failed:1,results:[{host:'web.push.apple.com',status:403,reason:'{"reason":"BadJwtToken"}'}]}}));
 await page.addInitScript(state=>{
  Object.defineProperty(window,'Notification',{configurable:true,value:{permission:state==='denied'?'denied':'granted'}});
  Object.defineProperty(window,'PushManager',{configurable:true,value:class {}});
  Object.defineProperty(navigator.serviceWorker,'getRegistration',{configurable:true,value:async()=>({pushManager:{getSubscription:async()=>state==='on'?{endpoint:'https://web.push.apple.com/fake-device-test',toJSON:()=>({endpoint:'https://web.push.apple.com/fake-device-test'})}:null}})});
 },state);
 await page.goto('/');await page.getByRole('button',{name:'Account settings',exact:true}).click();
 await expect(page.getByText(state==='on'?'Reminders on this device: on':state==='missing'?'Permission granted but not subscribed. Turn on again.':/Permission denied\. Enable/,{exact:state!=='denied'})).toBeVisible();
 if(state==='on'){
  await page.getByRole('button',{name:'Send test notification',exact:true}).click();await expect(page.getByRole('status')).toContainText('Apple rejected it (403 BadJwtToken).');
 }
 await page.getByText('Delivery log',{exact:true}).click();await expect(page.locator('details')).toContainText('Apple rejected it (403 BadJwtToken).');await page.getByText('Delivery log',{exact:true}).scrollIntoViewIfNeeded();await shot(page,info.project.name,`notification-${state}`);
});

});

test('anonymous counts uses credentialless same-origin transport in Chromium and WebKit',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(navigator,'doNotTrack',{configurable:true,value:'0'});Object.defineProperty(navigator,'globalPrivacyControl',{configurable:true,value:false});localStorage.setItem('incord.stats.enabled','1')});
 const sent=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/stats');await page.goto('/');const response=await sent;
 expect(response.status()).toBe(200);const request=response.request(),headers=await request.allHeaders();expect(headers.origin).toBe(new URL(page.url()).origin);expect(headers.cookie).toBeUndefined();const payload=request.postDataJSON();expect(Object.keys(payload).sort()).toEqual(['events','token']);expect(payload.events).toContain('app_open');
});
