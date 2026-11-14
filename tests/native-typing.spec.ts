import {test,expect,type Page} from '@playwright/test';
test.use({serviceWorkers:'block'});
const tab=async(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true}).click();
async function settings(page:Page){if(page.url()==='about:blank')await page.goto('/');else await tab(page,'Today');await page.getByRole('button',{name:'Account settings',exact:true}).click()}
async function nativeMode(page:Page){await settings(page);await page.getByLabel('Typing',{exact:true}).selectOption('native')}
async function longPassage(page:Page){await tab(page,'Discover');await page.locator('.passage-cards').getByRole('button',{name:/Romans 8:31–39/}).click();await page.getByRole('dialog').getByRole('button',{name:'Add to my library',exact:true}).click();await page.getByRole('button',{name:/^Romans 8:31–39/}).click();await expect(page.locator('.native-typing-input')).toBeFocused()}
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({'CF-Connecting-IP':'native-'+crypto.randomUUID()})});
test('native input commits one answer per fill, paste or composition and keeps normal slip scoring',async({page})=>{
 await page.addInitScript(()=>{(window as any).__feedbackCalls=0;Object.defineProperty(navigator,'vibrate',{configurable:true,value:()=>{(window as any).__feedbackCalls++;return true}});(window as any).AudioContext=class{constructor(){(window as any).__feedbackCalls++}}});
 await nativeMode(page);await page.getByLabel('Key sounds',{exact:true}).check();await page.getByLabel('Haptics',{exact:true}).check();await longPassage(page);
 const input=page.locator('.native-typing-input');await expect(page.locator('.keyboard')).toHaveCount(0);
 await input.fill('For many words pasted');await expect(page.locator('[data-word="1"]')).toHaveClass(/current/);await expect(input).toHaveValue('');
 await input.fill(' ,.—');await expect(page.locator('[data-word="1"]')).toHaveClass(/current/);
 await input.evaluate(node=>{const input=node as HTMLInputElement;input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.value='x';input.dispatchEvent(new InputEvent('input',{bubbles:true,data:'x',isComposing:true}));});
 await expect(page.locator('[data-word="1"]')).toHaveClass(/current/);
 await input.evaluate(node=>node.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'x'})));
 await expect(page.locator('[data-word="2"]')).toHaveClass(/current/);await expect(page.locator('[data-word="1"]')).toHaveClass(/slip/);
 await page.keyboard.type('w');await expect(page.locator('[data-word="3"]')).toHaveClass(/current/);
 await page.getByRole('button',{name:'Peek',exact:true}).tap();await expect(page.locator('[data-word="4"]')).toHaveClass(/current/);await expect(input).toBeFocused();
 expect(await page.evaluate(()=>(window as any).__feedbackCalls)).toBe(0);
 await page.getByRole('button',{name:'Close practice',exact:true}).click();await expect(input).toHaveCount(0);
});
test('native keyboard stays focused through result and next step, recording identical hidden-word slips',async({page})=>{
 await nativeMode(page);await tab(page,'Discover');await page.getByRole('button',{name:'Your text',exact:true}).click();await page.getByLabel('Title or question',{exact:true}).fill('Native test');await page.getByLabel('Text to remember',{exact:true}).fill('Faith hope love');await page.getByRole('button',{name:'Add your text',exact:true}).click();await page.getByRole('button',{name:/^Native test/}).click();
 const input=page.locator('.native-typing-input');await expect(input).toBeFocused();
 // Model an open keyboard plus the installed iPhone's top safe area.
 await page.evaluate(()=>{Object.defineProperties(window.visualViewport!,{height:{configurable:true,value:400},offsetTop:{configurable:true,value:0}});window.visualViewport!.dispatchEvent(new Event('resize'));(document.querySelector('.native-practice') as HTMLElement).style.paddingTop='67px'});
 await page.keyboard.type('fhl');await expect(page.locator('.native-result')).toBeVisible();await expect(input).toBeFocused();
 await expect.poll(async()=>(await input.boundingBox())!.y+(await input.boundingBox())!.height).toBeLessThanOrEqual(400);
 const peek=await page.getByRole('button',{name:'Peek',exact:true}).boundingBox();expect(peek!.y+peek!.height).toBeLessThanOrEqual(400);
 await page.getByRole('button',{name:'Continue',exact:true}).click();await expect(input).toBeFocused();
 const hidden=await page.locator('[data-word][data-hidden="true"]').count();expect(hidden).toBeGreaterThan(0);
 await page.keyboard.type('xxx');await expect(page.locator('.native-result')).toContainText(`${hidden} ${hidden===1?'slip':'slips'}`);await expect(input).toBeFocused();
});
test('reduced visual viewport keeps Peek reachable and long passage active word in middle band',async({page})=>{
 await page.setViewportSize({width:393,height:852});await nativeMode(page);await longPassage(page);
 await page.evaluate(()=>{const visual=window.visualViewport!;Object.defineProperties(visual,{height:{configurable:true,value:460},offsetTop:{configurable:true,value:20}});visual.dispatchEvent(new Event('resize'))});
 const words=await page.locator('[data-word]').allTextContents();for(const word of words.slice(0,60))await page.keyboard.type(word.replace(/^[^a-z0-9]+/i,'')[0].toLowerCase());
 await expect.poll(async()=>{const b=await page.locator('[data-word="60"]').boundingBox();return b?b.y+b.height/2:0}).toBeGreaterThan(20+460*.25);
 await expect.poll(async()=>{const b=await page.locator('[data-word="60"]').boundingBox();return b?b.y+b.height/2:852}).toBeLessThan(20+460*.65);
 const peek=await page.getByRole('button',{name:'Peek',exact:true}).boundingBox();expect(peek!.y).toBeGreaterThan(20);expect(peek!.y+peek!.height).toBeLessThanOrEqual(480);
 await expect(page.locator('.native-typing-input')).toBeFocused();
 await page.setViewportSize({width:1000,height:852});
 const practice=await page.locator('.native-practice').boundingBox();expect(practice!.width).toBeLessThanOrEqual(520);expect(Math.abs(practice!.x-(1000-practice!.width)/2)).toBeLessThan(1);
});
test('signed-in typing preference persists after sync/reload and reaches second device',async({page,browser,baseURL})=>{
 const email=`native-${crypto.randomUUID()}@example.com`;
 async function signin(p:Page){await settings(p);await p.getByLabel('Email address',{exact:true}).fill(email);await p.getByRole('button',{name:'Email me a code',exact:true}).click();await expect(p.getByLabel('Six-digit code')).toBeVisible();const {code}=await(await p.request.get('/api/test/last-code?email='+encodeURIComponent(email))).json();await p.getByLabel('Six-digit code').fill(code);await expect(p.getByText('Signed in.',{exact:true})).toBeVisible()}
 await signin(page);await expect(page.getByLabel('Typing',{exact:true})).toHaveValue('incord');await page.getByLabel('Typing',{exact:true}).selectOption('native');
 await expect.poll(async()=>(await(await page.request.get('/api/export')).json()).settings.typingMode).toBe('native');await page.reload();await settings(page);await expect(page.getByLabel('Typing',{exact:true})).toHaveValue('native');
 const context=await browser.newContext({baseURL,viewport:{width:393,height:852},extraHTTPHeaders:{'CF-Connecting-IP':'native-second-'+crypto.randomUUID()}});
 try{const second=await context.newPage();await signin(second);await expect(second.getByLabel('Typing',{exact:true})).toHaveValue('native');await second.reload();await settings(second);await expect(second.getByLabel('Typing',{exact:true})).toHaveValue('native')}finally{await context.close()}
});
