import {test,expect,type Page,type Locator} from '@playwright/test';
test.use({serviceWorkers:'block'});
const tap=async(button:Locator)=>{await button.waitFor({state:'visible'});await button.page().evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const overlay=button.locator('xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]');if(await overlay.count())await overlay.tap();else await button.click()};
const tab=async(page:Page,name:string)=>{const button=page.getByRole('navigation').getByRole('button',{name,exact:true});await tap(button);await expect(button).toHaveAttribute('aria-current','page')};
async function settings(page:Page){await page.goto('/');await page.getByRole('button',{name:'Account settings',exact:true}).click()}
// Chromium's CDP supplies real touch scrolling (not merely dispatched DOM events).
for(const mode of ['ios-overlay','ios-off','android'] as const)test(`${mode}: swiping Settings, a tab, and a Discover card scrolls without activation`,async({page})=>{
 await page.addInitScript(mode=>{
  Object.defineProperty(navigator,'userAgent',{value:mode==='android'?'Android':'iPhone OS 27_2',configurable:true});
  Object.defineProperty(navigator,'vibrate',{value:mode==='android'?()=>true:undefined,configurable:true});
 },mode);
 await settings(page);
 if(mode!=='ios-off')await page.getByLabel('Haptics',{exact:true}).check();
 const cdp=await page.context().newCDPSession(page);
 async function swipe(button:Locator){
  await button.scrollIntoViewIfNeeded();await page.waitForTimeout(150);
  const overlay=button.locator('xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]');
  const target=await overlay.count()?overlay:button;
  await button.evaluate(button=>{button.dataset.swipeClicks='0';button.addEventListener('click',()=>button.dataset.swipeClicks=String(Number(button.dataset.swipeClicks)+1))});
  const box=(await target.boundingBox())!,x=box.x+box.width/2,y=box.y+box.height/2;
  // Leave room below each screen so even fixed-tab swipes have a real scroll surface.
  await page.evaluate(()=>{document.querySelector('main')!.style.paddingBottom='1200px'});
  const before=await page.evaluate(()=>window.scrollY);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-i*15}]});await page.waitForTimeout(20)}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(before);
  await expect(button).toHaveAttribute('data-swipe-clicks','0');
  // Reproduce WebKit's late switch click even when this engine suppresses it.
  if(mode==='ios-overlay'){
   await target.evaluate(input=>(input as HTMLInputElement).click());
   await page.waitForTimeout(50);await expect(button).toHaveAttribute('data-swipe-clicks','0');
  }
  await page.waitForTimeout(400);
  await tap(button);await expect.poll(()=>button.getAttribute('data-swipe-clicks')).toBe('1');
 }
 await swipe(page.getByRole('button',{name:mode==='ios-off'?'Test sound':'Test haptic',exact:true}));
 await swipe(page.getByRole('navigation').getByRole('button',{name:'Discover',exact:true}));
 await tap(page.getByRole('button',{name:'Passages',exact:true}));
 // Cards sit in a horizontal scroller; vertical pans must still reach the page.
 await swipe(page.locator('.featured-cards').getByRole('button',{name:/^Psalm 23/}));
 await expect(page.getByRole('dialog')).toBeVisible();await cdp.detach();
});
