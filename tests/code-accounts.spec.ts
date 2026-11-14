import {testIp} from './network';
import {test, expect, type Page, type Locator, type APIResponse, type Browser, type BrowserContext} from '@playwright/test';
import {createHash, randomBytes} from 'node:crypto';

// Real local Worker identities and sync. Only native copy/share/print are stubbed.
// Codes are disposable synthetic credentials; never use a real account in this suite.
const createLabel='Create an account with a sign-in code';
const savedLabel="I saved this code. It can't be recovered.";
const codeSection=(page:Page)=>page.getByRole('region',{name:'Sign-in code',exact:true});
const saveSheet=(page:Page)=>page.getByRole('dialog',{name:'Save your sign-in code',exact:true});
const signinForm=(page:Page)=>page.getByRole('form',{name:'Sign in with a code',exact:true});
async function checked(response:APIResponse){expect(response.ok(),`HTTP ${response.status()}`).toBe(true);return response.json()}
async function me(page:Page){return (await checked(await page.request.get('/api/me'))).user}
async function exported(page:Page){return checked(await page.request.get('/api/export'))}
function origin(page:Page){return {Origin:new URL(page.url()).origin}}
async function tap(button:Locator){
 await button.waitFor({state:'visible'});
 await button.page().evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const overlay=button.locator('xpath=following-sibling::*[1][self::input[contains(@class,"haptic-overlay")]]');
 if(await overlay.count())await overlay.tap();else await button.click();
}
async function tab(page:Page,name:string){const button=page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('button',{name,exact:true});await tap(button);await expect(button).toHaveAttribute('aria-current','page')}
async function settings(page:Page){await tap(page.getByRole('button',{name:'Account settings',exact:true}));await expect(page.getByRole('heading',{name:'Account',exact:true})).toBeVisible()}
async function openAccount(page:Page){await page.goto('/');await settings(page)}
// Linux MiniBrowser crashes when navigating a document with the app's history guard.
// Keep real reload coverage in Chromium; WebKit reads the same persisted storage in a fresh document.
async function freshDocument(page:Page,browserName:string,url=page.url()){if(browserName!=='webkit'){if(url===page.url())await page.reload();else await page.goto(url);return page}const context=page.context();await page.close();const next=await context.newPage();await next.goto(url);return next}

async function noBanner(page:Page){await expect(page.locator('.page > .notice')).toHaveCount(0)}
async function readCode(page:Page){const value=(await saveSheet(page).locator('.signin-code-value').innerText()).trim();expect(value).toMatch(/^[a-z]+-[a-z]+-[a-z]+-\d{4}$/);return value}
async function saveCode(page:Page){
 let sheet=saveSheet(page);await expect(sheet).toBeVisible();await expect(sheet.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
 await sheet.getByRole('checkbox',{name:savedLabel,exact:true}).check();await tap(sheet.getByRole('button',{name:'Continue',exact:true}));await expect(sheet).toHaveCount(0);
}
async function create(page:Page){await tap(page.getByRole('button',{name:createLabel,exact:true}));const code=await readCode(page);await saveCode(page);await expect(codeSection(page)).toBeVisible();expect(await me(page)).toMatchObject({hasCode:true,hasEmail:false,hasGoogle:false});return code}
async function signin(page:Page,code:string){await signinForm(page).getByLabel('Your sign-in code',{exact:true}).fill(code);await tap(signinForm(page).getByRole('button',{name:'Sign in with a code',exact:true}));await expect(codeSection(page)).toBeVisible()}
async function signout(page:Page){await tap(page.getByRole('button',{name:'Sign out',exact:true}));await tap(page.getByRole('dialog').getByRole('button',{name:'Sign out',exact:true}));await expect(signinForm(page)).toBeVisible()}
async function otherContext(browser:Browser,baseURL:string|undefined):Promise<BrowserContext>{return browser.newContext({baseURL,viewport:{width:393,height:852},isMobile:true,hasTouch:true,serviceWorkers:'block',extraHTTPHeaders:{'CF-Connecting-IP':testIp()}})}
async function addOwn(page:Page,title:string){
 await tab(page,'Discover');await tap(page.getByRole('button',{name:'Add your own',exact:true}));await tap(page.getByRole('button',{name:'Your text',exact:true}));
 await page.getByLabel('Title or question').fill(title);await page.getByLabel('Text to remember').fill('Grace and peace be with you always.');await tap(page.getByRole('button',{name:'Add your text',exact:true}));
 await expect(page.locator('.action-feedback[role="status"]')).toHaveText('1 item added to your library.');
}
async function seeOwn(page:Page,title:string){await tab(page,'Library');await tap(page.getByRole('button',{name:/^My texts/}));await expect(page.getByText(title,{exact:true})).toBeVisible()}
async function linkEmail(page:Page,email:string){
 await tap(page.getByRole('button',{name:'Add email sign-in',exact:true}));const form=page.getByRole('form',{name:'Add email sign-in',exact:true});
 await form.getByLabel('Email address',{exact:true}).fill(email);await tap(form.getByRole('button',{name:'Email me a code',exact:true}));await expect(form.getByLabel('Six-digit code')).toBeVisible();
 const {code}=await checked(await page.request.get('/api/test/last-code?email='+encodeURIComponent(email)));
 await form.getByLabel('Six-digit code').fill(code);await expect(form).toHaveCount(0);await expect.poll(async()=>(await me(page)).hasEmail).toBe(true);
}

test.use({serviceWorkers:'block'});
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({'CF-Connecting-IP':testIp()})});

test('create and save a code, add own text, then restore the same library on a second device',async({page,browser,baseURL})=>{
 await openAccount(page);await expect(page.getByLabel('Email address',{exact:true})).toBeVisible();
 const ordered=await page.locator('.settings-group').first().getByRole('button').allTextContents();
 expect(ordered.indexOf(createLabel)).toBeGreaterThan(ordered.indexOf('Email me a code'));
 const code=await create(page),user=await me(page),title='Code library '+crypto.randomUUID();
 expect(user.codeRevision).toEqual(expect.any(String));await noBanner(page);
 await addOwn(page,title);await expect.poll(async()=>(await exported(page)).items.filter((i:any)=>i.title===title).length).toBe(1);
 const context=await otherContext(browser,baseURL);
 try{
  const other=await context.newPage();await openAccount(other);await signin(other,code.toUpperCase().replaceAll('-',''));
  expect((await me(other)).id).toBe(user.id);await noBanner(other);await seeOwn(other,title);
  expect((await exported(other)).items.filter((i:any)=>i.title===title)).toHaveLength(1);
 }finally{await context.close()}
});

test('required save sheet survives reload and Back, and copy/share/print stay within the sheet',async({page,browserName})=>{
 await page.context().addInitScript(()=>{
  (window as any).__codeActions={};
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).__codeActions.copied=text}}});
  Object.defineProperty(navigator,'share',{configurable:true,value:async(value:ShareData)=>{(window as any).__codeActions.shared=value.text}});
  window.print=()=>{(window as any).__codeActions.printed=true};
 });
 await openAccount(page);await tap(page.getByRole('button',{name:createLabel,exact:true}));const code=await readCode(page),user=await me(page);
 let sheet=saveSheet(page);await expect(sheet.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();await expect(sheet.getByRole('button',{name:'Close dialog',exact:true})).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(sheet).toBeVisible();await page.goBack();await expect(sheet).toBeVisible();
 page=await freshDocument(page,browserName);sheet=saveSheet(page);await expect(sheet).toBeVisible();expect(await readCode(page)).toBe(code);expect((await me(page)).id).toBe(user.id);
 await expect(sheet.getByRole('checkbox',{name:savedLabel,exact:true})).not.toBeChecked();await expect(sheet.getByRole('button',{name:'Continue',exact:true})).toBeDisabled();
 await tap(sheet.getByRole('button',{name:'Copy code',exact:true}));await expect(sheet.getByRole('status')).toHaveText('Code copied.');await noBanner(page);
 await tap(sheet.getByRole('button',{name:'Share code',exact:true}));await expect(sheet.getByRole('status').filter({hasText:'Code shared.'})).toBeVisible();
 await tap(sheet.getByRole('button',{name:'Print / Save as card',exact:true}));
 expect(await page.evaluate(()=>(window as any).__codeActions)).toEqual({copied:code,shared:code,printed:true});
 await expect(page.locator('html')).toHaveClass(/code-card-print/);await page.emulateMedia({media:'print'});await expect(page.locator('.signin-print-card')).toBeVisible();await expect(page.locator('main')).toBeHidden();await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));await expect(page.locator('.signin-print-card')).toBeHidden();await expect(page.locator('main')).toBeVisible();await page.emulateMedia({media:'screen'});
 await expect(page.locator('.signin-print-card .signin-code-value')).toHaveText(code);
 await saveCode(page);await settings(page);await expect(codeSection(page).locator('.signin-code-value')).toHaveCount(0);
});

test('regeneration invalidates the old code without repeating or duplicating a local-item merge',async({page,browser,baseURL,browserName})=>{
 await page.goto('/');const title='Local before code '+crypto.randomUUID();await addOwn(page,title);await settings(page);
 const old=await create(page),user=await me(page);
 const merge=page.getByRole('dialog',{name:'Add the 1 item on this device to your account?',exact:true});await expect(merge).toBeVisible();await tap(merge.getByRole('button',{name:'Add',exact:true}));await expect(merge).toHaveCount(0);
 await expect.poll(async()=>(await exported(page)).items.filter((i:any)=>i.title===title).length).toBe(1);
 await tap(codeSection(page).getByRole('button',{name:'Regenerate code',exact:true}));
 const confirm=page.getByRole('dialog',{name:'Replace your sign-in code?',exact:true});await tap(confirm.getByRole('button',{name:'Replace code',exact:true}));
 const next=await readCode(page);expect(next).not.toBe(old);await saveCode(page);await expect(page.getByRole('dialog')).toHaveCount(0);
 expect(await me(page)).toMatchObject({id:user.id,hasCode:true});expect((await me(page)).codeRevision).not.toBe(user.codeRevision);
 const context=await otherContext(browser,baseURL);
 try{
  const other=await context.newPage();await openAccount(other);await signinForm(other).getByLabel('Your sign-in code',{exact:true}).fill(old);
  await tap(signinForm(other).getByRole('button',{name:'Sign in with a code',exact:true}));await expect(signinForm(other).getByRole('alert')).toBeVisible();await noBanner(other);expect(await me(other)).toBeNull();
  await signin(other,next);expect((await me(other)).id).toBe(user.id);await seeOwn(other,title);
  page=await freshDocument(page,browserName);await settings(page);await expect(page.getByRole('dialog')).toHaveCount(0);expect((await exported(page)).items.filter((i:any)=>i.title===title)).toHaveLength(1);
 }finally{await context.close()}
});

test('adding email keeps UID and library and permits removing code without losing email access',async({page})=>{
 await openAccount(page);const code=await create(page),user=await me(page),title='Linked data '+crypto.randomUUID();await addOwn(page,title);await settings(page);
 await expect(codeSection(page).getByRole('button',{name:'Remove sign-in code',exact:true})).toHaveCount(0);
 expect((await page.request.post('/api/auth/code/remove',{headers:origin(page),data:{}})).status()).toBe(409);
 const email=`code-link-${crypto.randomUUID()}@example.com`;await linkEmail(page,email);expect(await me(page)).toMatchObject({id:user.id,hasEmail:true,hasCode:true});
 await tap(codeSection(page).getByRole('button',{name:'Remove sign-in code',exact:true}));const confirm=page.getByRole('dialog',{name:'Remove your sign-in code?',exact:true});
 await tap(confirm.getByRole('button',{name:'Remove sign-in code',exact:true}));await expect(confirm).toHaveCount(0);await expect(codeSection(page).getByRole('status')).toHaveText('Sign-in code removed.');await noBanner(page);
 expect(await me(page)).toMatchObject({id:user.id,hasEmail:true,hasCode:false,codeRevision:null});expect(await page.evaluate(()=>localStorage.getItem('bh_signin_code'))).toBeNull();
 expect((await exported(page)).items.filter((i:any)=>i.title===title)).toHaveLength(1);await signout(page);
 await signinForm(page).getByLabel('Your sign-in code',{exact:true}).fill(code);await tap(signinForm(page).getByRole('button',{name:'Sign in with a code',exact:true}));await expect(signinForm(page).getByRole('alert')).toBeVisible();await noBanner(page);
 const emailForm=page.getByRole('form',{name:'Sign in with email',exact:true});await emailForm.getByLabel('Email address',{exact:true}).fill(email);await tap(emailForm.getByRole('button',{name:'Email me a code',exact:true}));await expect(emailForm.getByLabel('Six-digit code')).toBeVisible();
 const sent=await checked(await page.request.get('/api/test/last-code?email='+encodeURIComponent(email)));await emailForm.getByLabel('Six-digit code').fill(sent.code);
 await expect(codeSection(page)).toBeVisible();expect((await me(page)).id).toBe(user.id);await seeOwn(page,title);
});

test('code is hidden until revealed, reminder dismissal lasts 30 days, and signout clears device cache',async({page,browserName})=>{
 await openAccount(page);const code=await create(page);let section=codeSection(page);
 await expect(section.locator('.signin-code-value')).toHaveCount(0);await expect(page.locator('.signin-print-card')).toHaveCount(0);
 await expect(section.getByRole('button',{name:'Reveal code',exact:true})).toHaveAttribute('aria-expanded','false');await tap(section.getByRole('button',{name:'Reveal code',exact:true}));await expect(section.getByRole('button',{name:'Hide code',exact:true})).toHaveAttribute('aria-expanded','true');await expect(section.locator('.signin-code-value')).toHaveText(code);
 await tab(page,'Today');await settings(page);await expect(section.locator('.signin-code-value')).toHaveCount(0);
 let reminder=section.getByText("Add email or Google so you can't get locked out",{exact:true});await expect(reminder).toBeVisible();
 const before=await page.evaluate(()=>Date.now());await tap(section.getByRole('button',{name:'Remind me in 30 days',exact:true}));await expect(reminder).toHaveCount(0);
 const until=await page.evaluate(()=>JSON.parse(localStorage.getItem('bh_code_backup_reminder')!).until);expect(until-before).toBeGreaterThanOrEqual(30*86400000);expect(until-before).toBeLessThan(30*86400000+10000);
 page=await freshDocument(page,browserName);await settings(page);section=codeSection(page);reminder=section.getByText("Add email or Google so you can't get locked out",{exact:true});await expect(reminder).toHaveCount(0);await expect(section.locator('.signin-code-value')).toHaveCount(0);
 await page.evaluate(()=>{const key='bh_code_backup_reminder',value=JSON.parse(localStorage.getItem(key)!);localStorage.setItem(key,JSON.stringify({...value,until:Date.now()-1}))});page=await freshDocument(page,browserName);await settings(page);section=codeSection(page);reminder=section.getByText("Add email or Google so you can't get locked out",{exact:true});await expect(reminder).toBeVisible();
 await signout(page);expect(await page.evaluate(()=>localStorage.getItem('bh_signin_code'))).toBeNull();await expect(page.locator('.signin-code-value')).toHaveCount(0);
 page=await freshDocument(page,browserName);await settings(page);await expect(signinForm(page)).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('bh_signin_code'))).toBeNull();
});

test('code sign-in resumes a Groups invite and a real MCP OAuth consent flow',async({page,browser,baseURL,browserName})=>{
 await openAccount(page);await create(page);const name='Code circle '+crypto.randomUUID().slice(0,8);
 const created=await checked(await page.request.post('/api/groups',{headers:origin(page),data:{name}}));
 const context=await otherContext(browser,baseURL);
 try{
  let other=await context.newPage();await openAccount(other);const code=await create(other),user=await me(other);await signout(other);
  other=await freshDocument(other,browserName,created.invite.url);await settings(other);
  await signinForm(other).getByLabel('Your sign-in code',{exact:true}).fill(code);await tap(signinForm(other).getByRole('button',{name:'Sign in with a code',exact:true}));
  const groups=other.getByRole('region',{name:'Groups',exact:true});await expect(groups.getByRole('article',{name,exact:true})).toBeVisible();expect((await me(other)).id).toBe(user.id);
  expect((await checked(await page.request.get('/api/groups/'+created.group.id))).group.memberCount).toBe(2);
  await settings(other);await signout(other);
  const callback='http://localhost:19876/callback',clientName='Code MCP '+crypto.randomUUID(),resource=new URL('/mcp',baseURL).href;
  const client=await checked(await other.request.post('/oauth/register',{data:{client_name:clientName,redirect_uris:[callback],token_endpoint_auth_method:'none',grant_types:['authorization_code'],response_types:['code']}}));
  const verifier=randomBytes(32).toString('base64url'),state=crypto.randomUUID();
  const params=new URLSearchParams({client_id:client.client_id,redirect_uri:callback,response_type:'code',scope:'library:read',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state,resource});
  other=await freshDocument(other,browserName,new URL('/oauth/authorize?'+params,baseURL).href);await expect(other.getByRole('heading',{name:'Sign in to connect an app',exact:true})).toBeVisible();
  const consentLoaded=other.waitForResponse(response=>new URL(response.url()).pathname==='/api/oauth/consent'&&response.request().method()==='GET'&&response.status()===200);
  await signinForm(other).getByLabel('Your sign-in code',{exact:true}).fill(code);await tap(signinForm(other).getByRole('button',{name:'Sign in with a code',exact:true}));
  const consentResponse=await consentLoaded;
  if(browserName==='webkit'&&new URL(other.url()).protocol==='http:'){
   // MiniBrowser rejects Secure __Host cookies on HTTP loopback. Supply the
   // actual server-issued browser binding on the real POST, as HTTPS would.
   // No consent/session validation or endpoint is mocked.
   const binding=(await consentResponse.headerValue('set-cookie'))?.split(';')[0];expect(binding?.startsWith('__Host-oauth-consent-')).toBe(true);
   await other.route('**/api/oauth/consent',async route=>{
    const request=route.request();if(request.method()!=='POST')return route.continue();
    // WebKit also strips Cookie from continued browser requests. Send the same
    // request through Playwright's HTTP transport, with the real session and
    // binding cookies, then return the unmodified server response to the UI.
    const cookies=await context.cookies(request.url());
    const cookie=[...cookies.map(value=>value.name+'='+value.value),binding].filter(Boolean).join('; ');
    const response=await route.fetch({headers:{...request.headers(),cookie}});await route.fulfill({response});
   });
  }
  await expect(other.getByRole('heading',{name:clientName,exact:true})).toBeVisible();await expect(other.getByText('See your library, progress and groups',{exact:true})).toBeVisible();
  await other.route(callback+'**',route=>route.fulfill({contentType:'text/html',body:'<title>Returned to MCP client</title>'}));
  const returned=other.waitForRequest(request=>new URL(request.url()).origin+new URL(request.url()).pathname===callback);
  await tap(other.getByRole('button',{name:'Approve connection',exact:true}));const redirect=new URL((await returned).url());expect(redirect.searchParams.get('state')).toBe(state);await expect(other).toHaveTitle('Returned to MCP client');
  const tokens=await checked(await other.request.post('/oauth/token',{form:{grant_type:'authorization_code',client_id:client.client_id,redirect_uri:callback,code:redirect.searchParams.get('code')!,code_verifier:verifier,resource}}));
  const tools=await other.request.post(resource,{headers:{Authorization:'Bearer '+tokens.access_token,Accept:'application/json, text/event-stream'},data:{jsonrpc:'2.0',id:1,method:'tools/list',params:{}}});expect(tools.ok()).toBe(true);expect(await tools.text()).toContain('list_library');
 }finally{await page.request.delete('/api/groups/'+created.group.id,{headers:origin(page)});await context.close()}
});


test('Google link failures stay inline and a device without a saved code can regenerate',async({page})=>{
 await page.goto('/');const response=await page.request.post('/api/auth/code/create',{headers:origin(page),data:{}});expect(response.ok()).toBe(true);
 const other=await page.context().newPage();try{await other.goto('/?googleLink=collision');await expect(other.getByRole('heading',{name:'Account',exact:true})).toBeVisible();await expect(other.locator('.settings-group').first().getByRole('alert')).toHaveText('That Google account already belongs to another account. Use a different Google account to link this one.');await noBanner(other);
 const section=codeSection(other);await expect(section.getByRole('button',{name:'Reveal code',exact:true})).toHaveCount(0);await expect(section.getByText("This device doesn't have a saved copy. You can create a new code below.",{exact:true})).toBeVisible();await tap(section.getByRole('button',{name:'Regenerate code',exact:true}));await tap(other.getByRole('dialog').getByRole('button',{name:'Replace code',exact:true}));await readCode(other);await saveCode(other);
 }finally{await other.close()}
});
