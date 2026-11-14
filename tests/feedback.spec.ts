import {finishEmailSignin} from './email-handoff';
import {testIp} from './network';
import {test,expect,type Page} from './accounts-playwright';

const thanks='Thanks — Eric reads every one.';
const form=(page:Page)=>page.getByRole('form',{name:'Send feedback',exact:true});
async function settings(page:Page){await page.goto('/');await page.getByRole('button',{name:'Account settings',exact:true}).click();await expect(form(page)).toBeVisible()}
async function submit(page:Page,message:string){
 await form(page).getByLabel('Message',{exact:true}).fill(message);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/feedback'&&r.request().method()==='POST');
 await form(page).getByRole('button',{name:'Send feedback',exact:true}).click();
 const result=await response;expect(result.status(),await result.text()).toBe(200);
 await expect(form(page).getByRole('status')).toHaveText(thanks);
 await expect(form(page).getByRole('status')).toBeInViewport({ratio:1});
 expect(await form(page).getByRole('status').evaluate(el=>el.previousElementSibling?.tagName)).toBe('BUTTON');
 return result.request().postDataJSON();
}
async function stats(page:Page,message:string){
 // Admin review is a separate browser page, not a navigation of the app under test.
 const report=await page.context().newPage();
 try{
  await report.goto('/stats');await report.getByLabel('Stats token').fill('incord-playwright-local-stats-token-32chars');await report.getByRole('button',{name:'View counts',exact:true}).click();
  await expect(report.getByRole('heading',{name:'Latest feedback',exact:true})).toBeVisible();
  await expect(report.getByText(message,{exact:true})).toBeVisible();
 }finally{await report.close()}
}

test.use({serviceWorkers:'block',viewport:{width:393,height:852}});
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({'CF-Connecting-IP':testIp()})});

test('signed-out feedback sends only chosen fields to the real Worker and appears in private stats',async({page})=>{
 await settings(page);const f=form(page);
 await expect(f.getByLabel('Email me back (optional)',{exact:true})).toHaveValue('');
 await expect(f.getByRole('checkbox')).toBeChecked();
 await f.getByRole('checkbox').uncheck();await f.getByLabel('Kind',{exact:true}).selectOption('Idea');
 const message='Signed-out idea '+crypto.randomUUID();
 expect(await submit(page,message)).toEqual({kind:'Idea',message});
 await expect(f.getByLabel('Message',{exact:true})).toHaveValue('');
 await page.reload();await page.getByRole('button',{name:'Account settings',exact:true}).click();
 await expect(form(page).getByLabel('Message',{exact:true})).toHaveValue('');
 await expect(form(page).getByLabel('Email me back (optional)',{exact:true})).toHaveValue('');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
 await stats(page,message);
});

test('real sink email login never fills feedback contact; signed-in metadata stays coarse and optional contact is explicit',async({page})=>{
 await settings(page);const email=`feedback-${crypto.randomUUID()}@example.com`;
 await page.getByLabel('Email address',{exact:true}).fill(email);await page.getByRole('button',{name:'Email me a code',exact:true}).click();await expect(page.getByLabel('Six-digit code')).toBeVisible();
 const code=(await(await page.request.get('/api/test/last-code?email='+encodeURIComponent(email))).json()).code;
 await finishEmailSignin(page,code);
 const f=form(page);await expect(f.getByLabel('Email me back (optional)',{exact:true})).toHaveValue('');
 await f.getByLabel('Kind',{exact:true}).selectOption('Problem');
 const blankContact=await submit(page,'Signed-in blank contact '+crypto.randomUUID());
 expect(blankContact).not.toHaveProperty('contact');expect(blankContact.meta.signedIn).toBe(true);
 const reply='reply-'+crypto.randomUUID()+'@example.com';await f.getByLabel('Email me back (optional)',{exact:true}).fill(reply);
 const message='Signed-in problem '+crypto.randomUUID(),payload=await submit(page,message);
 expect(Object.keys(payload).sort()).toEqual(['contact','kind','message','meta']);
 expect(payload).toMatchObject({kind:'Problem',message,contact:reply,meta:{signedIn:true,viewport:{width:393,height:852}}});
 expect(Object.keys(payload.meta).sort()).toEqual(['platform','signedIn','uaFamily','version','viewport']);
 expect(payload.meta.version).toEqual(expect.any(String));expect(payload.meta.version.length).toBeGreaterThan(0);
 expect(['iOS','Android','macOS','Windows','Linux','Other']).toContain(payload.meta.platform);
 expect(['Safari','Chrome','Chromium','Firefox','Edge','Other']).toContain(payload.meta.uaFamily);
 expect(JSON.stringify(payload)).not.toContain(email);
 await expect(f.getByLabel('Email me back (optional)',{exact:true})).toHaveValue('');
 await page.reload();await page.getByRole('button',{name:'Account settings',exact:true}).click();await expect(form(page).getByLabel('Email me back (optional)',{exact:true})).toHaveValue('');
 await stats(page,message);
});

test('10–4000 character validation is inline, prevents invalid requests, and accepts both boundaries in the real sink',async({page})=>{
 await settings(page);const f=form(page);let requests=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/feedback')requests++});
 for(const message of ['', '123456789',' '.repeat(12)]){
  await f.getByLabel('Message',{exact:true}).fill(message);await f.getByRole('button',{name:'Send feedback',exact:true}).click();
  await expect(f.getByRole('alert')).toHaveText('Please write between 10 and 4000 characters.');await expect(f.getByRole('alert')).toBeInViewport({ratio:1});
 }
 // Bypass the native maxlength to exercise the submit guard as well.
 await f.getByLabel('Message',{exact:true}).evaluate(el=>{const input=el as HTMLTextAreaElement;input.value='x'.repeat(4001);input.dispatchEvent(new Event('input',{bubbles:true}))});
 await f.getByRole('button',{name:'Send feedback',exact:true}).click();await expect(f.getByRole('alert')).toHaveText('Please write between 10 and 4000 characters.');expect(requests).toBe(0);
 await f.getByRole('checkbox').uncheck();await f.getByLabel('Kind',{exact:true}).selectOption('Other');
 expect(await submit(page,'1234567890')).toEqual({kind:'Other',message:'1234567890'});
 await f.getByLabel('Message',{exact:true}).fill('Another valid feedback message');await f.getByLabel('Email me back (optional)',{exact:true}).fill('bad@example.com,other');await f.getByRole('button',{name:'Send feedback',exact:true}).click();await expect(f.getByRole('alert')).toHaveText('Please enter a valid email address, or leave it blank.');expect(requests).toBe(1);await f.getByLabel('Email me back (optional)',{exact:true}).fill('');
 const max='x'.repeat(4000);expect(await submit(page,max)).toEqual({kind:'Other',message:max});expect(requests).toBe(2);
});

test('server failure is immediately below the pressed busy button, visible above navigation at 393×852, and preserves the draft',async({page})=>{
 await settings(page);let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 await page.route('**/api/feedback',async route=>{await gate;await route.fulfill({status:503,json:{error:'Feedback is unavailable right now. Please try again.'}})});
 const f=form(page),draft='Please keep this feedback draft.';await f.getByLabel('Message',{exact:true}).fill(draft);
 await f.getByRole('button',{name:'Send feedback',exact:true}).click();const busy=f.getByRole('button',{name:'Sending…',exact:true});
 await expect(busy).toBeDisabled();await expect(busy).toHaveAttribute('aria-busy','true');await expect(busy).not.toHaveAttribute('aria-pressed');release();
 const alert=f.getByRole('alert');await expect(alert).toHaveText('Feedback is unavailable right now. Please try again.');await expect(alert).toBeInViewport({ratio:1});
 expect(await alert.evaluate(el=>el.previousElementSibling?.textContent)).toBe('Send feedback');await expect(alert).toBeFocused();
 const bounds=await alert.boundingBox(),bar=await page.locator('.tabbar').boundingBox();expect(bounds!.y+bounds!.height).toBeLessThan(bar!.y);
 await expect(f.getByLabel('Message',{exact:true})).toHaveValue(draft);await expect(page.locator('.notice.error')).toHaveCount(0);
 await page.unroute('**/api/feedback');await page.route('**/api/feedback',route=>route.abort('failed'));
 await f.getByRole('button',{name:'Send feedback',exact:true}).click();
 await expect(alert).toHaveText('Your feedback couldn’t be sent. Please try again when you’re online.');await expect(alert).toBeInViewport({ratio:1});await expect(f.getByLabel('Message',{exact:true})).toHaveValue(draft);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
});
