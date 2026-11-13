import {test,expect,type Page} from '@playwright/test';

async function settings(page:Page){await page.goto('/');await page.getByRole('button',{name:'Account settings',exact:true}).click()}
async function start(page:Page,email:string){await page.getByLabel('Email address',{exact:true}).fill(email);await page.getByRole('button',{name:'Email me a code',exact:true}).click();await expect(page.getByLabel('Six-digit code')).toBeVisible();return (await (await page.request.get('/api/test/last-code?email='+encodeURIComponent(email))).json()).code as string}
async function dismissRecovery(page:Page){const saved=page.getByRole('button',{name:'I saved my code',exact:true});if(await saved.count())await saved.click()}
async function signout(page:Page){await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByLabel('Email address',{exact:true})).toBeVisible()}
async function enrollLegacy(page:Page){
 const cdp=await page.context().newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 const options=await (await page.request.post('/api/auth/register/options',{headers:{Origin:new URL(page.url()).origin},data:{displayName:'Legacy account'}})).json();
 const response=await page.evaluate(async options=>{
  const decode=(v:string)=>Uint8Array.from(atob(v.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const publicKey={...options,challenge:decode(options.challenge),user:{...options.user,id:decode(options.user.id)},excludeCredentials:(options.excludeCredentials||[]).map((c:any)=>({...c,id:decode(c.id)}))};
  return (await navigator.credentials.create({publicKey}) as any).toJSON();
 },options);
 const registration=await page.request.post('/api/auth/register/verify',{headers:{Origin:new URL(page.url()).origin},data:{response}});expect(registration.ok()).toBe(true);
 return cdp;
}
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({'CF-Connecting-IP':'email-ui-'+crypto.randomUUID()})});

test('email signup is first in settings, six digits auto-submit, returning email preserves account',async({page})=>{
 await settings(page);await expect(page.locator('.settings-group').first()).toHaveAttribute('aria-labelledby','account-heading');
 await expect(page.getByRole('button',{name:/Create account with a passkey|Add a passkey/})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Sign in with your existing passkey',exact:true})).not.toBeVisible();
 const email=`signup-${crypto.randomUUID()}@example.com`,code=await start(page,email);
 await expect(page.getByRole('button',{name:/Resend in \d+s/})).toBeDisabled();
 await page.getByLabel('Six-digit code').fill(code.slice(0,5));await expect(page.getByRole('button',{name:'Verify code',exact:true})).toBeDisabled();
 await page.getByLabel('Six-digit code').fill(code);await expect(page.getByText('Signed in.',{exact:true})).toBeVisible();
 const first=(await (await page.request.get('/api/me')).json()).user;expect(first.hasEmail).toBe(true);
 await expect(page.getByRole('button',{name:'Add email sign-in',exact:true})).toHaveCount(0);
 await signout(page);await start(page,email);const next=(await (await page.request.get('/api/test/last-code?email='+encodeURIComponent(email))).json()).code;
 await page.getByLabel('Six-digit code').fill(next);await expect(page.getByText('Signed in.',{exact:true})).toBeVisible();expect((await (await page.request.get('/api/me')).json()).user.id).toBe(first.id);
 await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('busy controls, inline delivery and invalid-code errors, resend cooldown and change email',async({page})=>{
 await page.route('**/api/config',route=>route.fulfill({json:{email:true,google:true,googleEnabled:true}}));
 await settings(page);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/auth/email/start',async route=>{await gate;await route.fulfill({status:503,json:{error:'Email delivery unavailable. Try again.'}})});
 await page.getByLabel('Email address',{exact:true}).fill('error@example.com');await page.getByRole('button',{name:'Email me a code',exact:true}).click();await expect(page.getByRole('button',{name:'Sending code…',exact:true})).toBeDisabled();release();
 await expect(page.getByRole('form',{name:'Sign in with email'}).getByRole('alert')).toContainText('Email delivery unavailable');await expect(page.getByRole('form').getByRole('alert')).toBeInViewport({ratio:1});expect(await page.getByRole('form').getByRole('alert').evaluate(el=>el.previousElementSibling?.textContent)).toBe('Email me a code');
 await page.unroute('**/api/auth/email/start');await page.clock.install();const email=`retry-${crypto.randomUUID()}@example.com`;const code=await start(page,email);
 await page.getByLabel('Six-digit code').fill(code==='000000'?'111111':'000000');await expect(page.getByRole('form').getByRole('alert')).toContainText('invalid or expired');await expect(page.getByRole('form').getByRole('alert')).toBeInViewport({ratio:1});expect(await page.getByRole('form').getByRole('alert').evaluate(el=>el.previousElementSibling?.textContent)).toBe('Verify code');
 await page.clock.fastForward(31000);await expect(page.getByRole('button',{name:'Resend code',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Resend code',exact:true}).click();await expect(page.getByRole('button',{name:/Resend in \d+s/})).toBeDisabled();
 await page.getByRole('button',{name:'Use a different email',exact:true}).click();await expect(page.getByLabel('Email address',{exact:true})).toBeEnabled();await expect(page.getByLabel('Six-digit code')).toHaveCount(0);
});

test('feature toggle hides email while Google and collapsed legacy sign-in remain',async({page})=>{
 await page.route('**/api/config',route=>route.fulfill({json:{email:false,googleEnabled:true,passkeys:true}}));await settings(page);
 await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeVisible();await expect(page.getByLabel('Email address',{exact:true})).toHaveCount(0);
 await page.getByText('Signed up before November 14?',{exact:true}).click();await expect(page.getByRole('button',{name:'Sign in with your existing passkey',exact:true})).toBeVisible();await expect(page.getByLabel('One-time recovery code')).toBeVisible();
});

test('legacy passkey sign-in remains available only under the old-account disclosure',async({page})=>{
 await settings(page);const cdp=await enrollLegacy(page);await page.reload();await page.getByRole('button',{name:'Account settings',exact:true}).click();await dismissRecovery(page);
 const id=(await (await page.request.get('/api/me')).json()).user.id;
 await signout(page);await expect(page.getByRole('button',{name:'Sign in with your existing passkey',exact:true})).not.toBeVisible();await page.getByText('Signed up before November 14?',{exact:true}).click();await page.getByRole('button',{name:'Sign in with your existing passkey',exact:true}).click();await expect(page.getByText('Signed in.',{exact:true})).toBeVisible();expect((await (await page.request.get('/api/me')).json()).user.id).toBe(id);await expect(page.getByRole('button',{name:'Add email sign-in',exact:true})).toBeVisible();await cdp.detach();
});

test('legacy account explicitly adds email sign-in to the same account',async({page})=>{
 await settings(page);const cdp=await enrollLegacy(page);await page.reload();await page.getByRole('button',{name:'Account settings',exact:true}).click();await dismissRecovery(page);const id=(await (await page.request.get('/api/me')).json()).user.id;
 await page.getByRole('button',{name:'Add email sign-in',exact:true}).click();const email=`link-${crypto.randomUUID()}@example.com`;
 const started=page.waitForRequest('**/api/auth/email/start');const code=await start(page,email);expect((await started).postDataJSON()).toMatchObject({email,link:true});
 const verified=page.waitForRequest('**/api/auth/email/verify');await page.getByLabel('Six-digit code').fill(code);expect((await verified).postDataJSON()).toMatchObject({email,code,link:true});await expect(page.getByRole('button',{name:'Add email sign-in',exact:true})).toHaveCount(0);await expect(page.getByText('Email sign-in added.',{exact:true})).toBeVisible();expect((await (await page.request.get('/api/me')).json()).user).toMatchObject({id,hasEmail:true});await cdp.detach();
});

 test('a second independent browser context signs into the same email account',async({page,browser,baseURL})=>{
 await settings(page);const email=`second-device-${crypto.randomUUID()}@example.com`,code=await start(page,email);await page.getByLabel('Six-digit code').fill(code);await expect(page.getByText('Signed in.',{exact:true})).toBeVisible();const first=(await(await page.request.get('/api/me')).json()).user;
 const context=await browser.newContext({baseURL,viewport:{width:393,height:852},extraHTTPHeaders:{'CF-Connecting-IP':'second-device-'+crypto.randomUUID()}});
 try {const other=await context.newPage();await settings(other);const code=await start(other,email);await other.getByLabel('Six-digit code').fill(code);await expect(other.getByText('Signed in.',{exact:true})).toBeVisible();expect((await(await other.request.get('/api/me')).json()).user.id).toBe(first.id);expect((await(await page.request.get('/api/me')).json()).user.id).toBe(first.id);await expect(other.getByRole('dialog')).toHaveCount(0)}finally{await context.close()}
 });
