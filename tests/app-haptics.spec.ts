import {test,expect,type Page,type Locator} from '@playwright/test';
test.use({serviceWorkers:'block'});
const tap=async(button:Locator)=>{await button.waitFor({state:'visible'});await button.page().evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const overlay=button.locator('xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]');if(await overlay.count())await overlay.tap();else await button.click()};
const tab=async(page:Page,name:string)=>{const button=page.getByRole('navigation').getByRole('button',{name,exact:true});await tap(button);await expect(button).toHaveAttribute('aria-current','page')};
async function settings(page:Page){await page.goto('/');await page.getByRole('button',{name:'Account settings',exact:true}).click()}
for(const width of [320,393])test(`iOS all tab items and shared primary buttons dispatch once at ${width}px, without changing layout or stealing focus`,async({page})=>{
 await page.setViewportSize({width,height:852});
 await page.addInitScript(()=>{
  Object.defineProperty(navigator,'vibrate',{value:undefined,configurable:true});Object.defineProperty(navigator,'userAgent',{value:'iPhone OS 27_2',configurable:true});
  (window as any).__buttonClicks=[];(window as any).__activationChecks=[];
  document.addEventListener('click',event=>{
   if(event.target instanceof HTMLButtonElement)(window as any).__buttonClicks.push(event.target.textContent?.trim());
   if(event.target instanceof HTMLInputElement&&event.target.classList.contains('haptic-overlay')){
    const input=event.target,button=input.previousElementSibling,clicks=(window as any).__buttonClicks.length;
    const changes:MutationRecord[]=[];const observer=new MutationObserver(records=>changes.push(...records));observer.observe(input.parentNode!,{childList:true});
    input.addEventListener('click',()=>{changes.push(...observer.takeRecords());observer.disconnect();(window as any).__activationChecks.push({connected:input.isConnected,sibling:input.previousElementSibling===button,checked:input.checked,buttonClicks:(window as any).__buttonClicks.length-clicks,moved:changes.some(change=>[...change.addedNodes,...change.removedNodes].includes(input))})},{once:true});
   }
  },true);
 });
 await settings(page);await expect(page.locator('.haptic-overlay')).toHaveCount(0);
 const scrollY=await page.evaluate(()=>window.scrollY);
 const before=await page.locator('button').evaluateAll(buttons=>buttons.map((button,i)=>{button.dataset.hapticTest=String(i);const b=button.getBoundingClientRect();return {i,x:b.x,y:b.y,width:b.width,height:b.height}}));
 await page.getByLabel('Haptics',{exact:true}).check();const saved=page.locator('.feedback-setting .action-feedback').filter({hasText:'Saved on this device.'});await expect(saved).toBeVisible();await expect(saved).toHaveCount(0,{timeout:4500});await expect.poll(()=>page.locator('.haptic-overlay').count()).toBeGreaterThan(5);await page.evaluate(y=>window.scrollTo(0,y),scrollY);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 for(const box of before){const after=await page.locator(`button[data-haptic-test="${box.i}"]`).boundingBox();if(!after)continue;for(const key of ['x','y','width','height'] as const)expect(Math.abs(after[key]-box[key])).toBeLessThan(0.6)}
 await expect(page.locator('input.haptic-button,textarea.haptic-button,select.haptic-button,a.haptic-button')).toHaveCount(0);
 await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur()});await tap(page.getByRole('button',{name:'Test haptic',exact:true}));await expect(page.locator('body')).toBeFocused();
 await expect(page.getByRole('navigation').getByRole('button')).toHaveCount(4);
 await expect(page.getByRole('navigation').getByRole('button')).toHaveText(['Today','Library','Discover','Groups']);
 await expect(page.getByRole('navigation').locator('.haptic-overlay')).toHaveCount(4);
 for(const name of ['Library','Discover','Groups','Today']){
  await page.evaluate(()=>(window as any).__buttonClicks=[]);await tab(page,name);
  await expect(page.getByRole('navigation').getByRole('button',{name,exact:true})).toHaveAttribute('aria-current','page');expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  expect(await page.evaluate(()=>(window as any).__buttonClicks)).toEqual([name]);
 }
 // Simulate keyed reconciliation moving an existing button: only its sibling
 // switch should follow, and Svelte-owned button nodes must never be reparented.
 await page.getByRole('navigation').evaluate(nav=>{const last=nav.querySelectorAll('button')[3];nav.insertBefore(last,nav.firstElementChild)});
 await expect.poll(()=>page.getByRole('navigation').evaluate(nav=>[...nav.querySelectorAll('button')].every(button=>button.parentElement===nav&&button.nextElementSibling?.classList.contains('haptic-overlay')))).toBe(true);
 await tab(page,'Library');await page.evaluate(()=>(window as any).__buttonClicks=[]);
 await tap(page.getByRole('button',{name:'Find something to memorize',exact:true}));
 await expect.poll(()=>page.evaluate(()=>(window as any).__buttonClicks)).toEqual(['Find something to memorize']);
 await expect(page.getByRole('heading',{name:'Start here',exact:true})).toBeVisible();
 await tap(page.getByRole('button',{name:'Passages',exact:true}));await tap(page.locator('.featured-cards').getByRole('button',{name:/^Psalm 23/}));
 await expect(page.getByRole('dialog')).toBeVisible();
 const add=page.getByRole('dialog').getByRole('button',{name:'Add to my library',exact:true});
 const overlay=add.locator('xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]');await expect(overlay).toHaveAttribute('aria-hidden','true');await expect(overlay).toHaveAttribute('tabindex','-1');
 await page.evaluate(()=>(window as any).__buttonClicks=[]);await tap(add);await expect.poll(()=>page.evaluate(()=>(window as any).__buttonClicks)).toEqual(['Add to my library']);
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.list .row')).toHaveCount(1);
 await tab(page,'Today');await page.evaluate(()=>(window as any).__buttonClicks=[]);
 const begin=page.getByRole('button',{name:'Begin',exact:true});
 await expect(begin.locator('xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]')).toHaveCount(1);await tap(begin);
 await expect(page.getByLabel('Practice',{exact:true})).toBeFocused();
 expect(await page.evaluate(()=>(window as any).__buttonClicks)).toEqual(['Begin']);
 await tap(page.getByRole('button',{name:'Close practice',exact:true}));await tab(page,'Today');
 await tap(page.getByRole('button',{name:'Account settings',exact:true}));
 const checks=await page.evaluate(()=>(window as any).__activationChecks);expect(checks.length).toBeGreaterThan(10);
 for(const check of checks)expect(check).toMatchObject({connected:true,sibling:true,buttonClicks:0,moved:false});
 await page.getByLabel('Haptics',{exact:true}).uncheck();await expect(page.locator('.haptic-overlay')).toHaveCount(0);
});
test('Android gives one vibration per button tap, none for native controls or while off',async({page})=>{
 await page.addInitScript(()=>{(window as any).__vibrations=[];Object.defineProperty(navigator,'vibrate',{configurable:true,value:(duration:number)=>{(window as any).__vibrations.push(duration);return true}})});
 await settings(page);await page.getByRole('button',{name:'Test sound',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vibrations)).toEqual([]);
 await page.getByLabel('Haptics',{exact:true}).check();expect(await page.evaluate(()=>(window as any).__vibrations)).toEqual([]);await expect(page.locator('.haptic-overlay')).toHaveCount(0);
 await page.getByRole('button',{name:'Test haptic',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vibrations)).toEqual([8]);
 await tab(page,'Library');expect(await page.evaluate(()=>(window as any).__vibrations)).toEqual([8,8]);
 await page.getByRole('button',{name:'Find something to memorize',exact:true}).click();expect(await page.evaluate(()=>(window as any).__vibrations)).toEqual([8,8,8]);
 await tab(page,'Today');await page.getByRole('button',{name:'Account settings',exact:true}).click();await page.getByLabel('Haptics',{exact:true}).uncheck();await page.evaluate(()=>(window as any).__vibrations=[]);
 await tab(page,'Library');await tab(page,'Today');expect(await page.evaluate(()=>(window as any).__vibrations)).toEqual([]);await expect(page.locator('.haptic-overlay')).toHaveCount(0);
});
