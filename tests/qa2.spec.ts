import {test,expect,type Page} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
async function emailSignin(page: Page, email: string) {
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a code', exact: true }).click();
  await expect(page.getByLabel('Six-digit code')).toBeVisible();
  const response = await page.request.get('/api/test/last-code?email=' + encodeURIComponent(email));
  expect(response.ok()).toBe(true);
  const { code } = await response.json();
  expect(code).toMatch(/^\d{6}$/);
  await page.getByLabel('Six-digit code').fill(code);
  await expect(page.getByText('Signed in.',{exact:true})).toBeVisible();
}
test.beforeEach(async({context})=>{await context.setExtraHTTPHeaders({'CF-Connecting-IP':'qa2-'+crypto.randomUUID()})});
const shots='test-results/screens/qa5';
async function shot(page:any,info:any,name:string){await mkdir(shots,{recursive:true});await page.screenshot({path:`${shots}/${info.project.name}-${name}.png`})}
test('N2/N8 Psalm 119 defaults to exclusive chunks and confirms the count above results',async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Discover',exact:true}).click();await page.getByLabel('Bible reference').fill('Psalm 119');await page.getByRole('button',{name:'Find verses',exact:true}).click();
 const chunks=page.getByRole('button',{name:'Chunks of ~4 verses',exact:true});await expect(chunks).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:'Add to library',exact:true})).toBeInViewport();await shot(page,info,'long-passage');
 await page.getByRole('button',{name:'Separate verses',exact:true}).click();await expect(chunks).toHaveAttribute('aria-pressed','false');
 await page.getByRole('button',{name:'One passage',exact:true}).click();await page.getByRole('button',{name:'Add to library',exact:true}).click();await expect(page.getByRole('dialog',{name:'Add 1 item?',exact:true})).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await chunks.click();await page.getByRole('button',{name:'Add to library',exact:true}).click();await expect(page.getByRole('dialog',{name:'Add 44 items?',exact:true})).toBeVisible();await shot(page,info,'long-confirm');
});
test('N4 confirms global signout and notifies another device only once',async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Account settings',exact:true}).click();
 await page.getByLabel('Display name').fill('Account name');await page.getByLabel('Display name').press('Tab');const email=`qa2-${crypto.randomUUID()}@example.com`;await emailSignin(page,email);await expect(page.getByText('Signed in.',{exact:true})).toBeVisible();
 const second=await page.context().browser()!.newContext({extraHTTPHeaders:{'CF-Connecting-IP':'qa2-secondary-'+crypto.randomUUID()}});const other=await second.newPage();await other.goto('/');await other.getByRole('button',{name:'Account settings',exact:true}).click();
 await emailSignin(other,email);
 await expect(other.getByText('Signed in.',{exact:true})).toBeVisible();

 await page.getByRole('button',{name:'Sign out everywhere',exact:true}).click();const confirm=page.getByRole('dialog',{name:'Sign out everywhere?',exact:true});await expect(confirm).toBeVisible();expect((await (await page.request.get('/api/me')).json()).user).toBeTruthy();await shot(page,info,'signout-confirm');
 await confirm.getByRole('button',{name:'Sign out everywhere',exact:true}).click();await expect(page.getByText('Account data removed from this device.',{exact:false})).toBeVisible();
 const stale=await other.request.get('/api/export');expect(stale.status()).toBe(401);
 await other.reload();await expect(other.getByRole('status')).toContainText('You were signed out on all devices.');await other.getByRole('button',{name:'Account settings',exact:true}).click();await other.getByLabel('Appearance').selectOption('dark');const nameClock=await other.evaluate(async()=>{const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('byheart',1);r.onsuccess=()=>resolve(r.result)});return await new Promise<number>(resolve=>{const r=db.transaction('state').objectStore('state').get('current');r.onsuccess=()=>resolve(r.result.settings.fieldUpdatedAt?.name||0)})});expect(nameClock).toBe(0);await other.reload();await expect(other.getByText('You were signed out on all devices.',{exact:true})).toHaveCount(0);await second.close();
});
test('N9/N10/N16/N20 article previews, checks, touch controls and backdrop dismissal',async({page},info)=>{
 await page.goto('/');await page.getByRole('button',{name:'Discover',exact:true}).click();await page.getByRole('button',{name:'Catechisms',exact:true}).click();await page.getByRole('combobox',{name:'Browse',exact:true}).selectOption({label:'Apostles’ Creed'});await expect(page.locator('summary').first()).toContainText('Article 1 · I believe in God the Father Almighty');await page.getByRole('button',{name:'Add article',exact:true}).first().click();await expect(page.locator('.document-add').first()).toHaveText('✓');await shot(page,info,'creed');
 for(const box of await page.locator('.bulk-actions button,.document-add').all())expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);
 await page.getByRole('button',{name:'All',exact:true}).click();await page.locator('.featured-cards button').first().click();await page.locator('.sheet-backdrop').click({position:{x:10,y:10}});await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('N15/N21 practiced dot contrast and long-title collapse on a short viewport',async({page},info)=>{
 await page.setViewportSize({width:375,height:667});await page.goto('/');await page.getByRole('button',{name:'Discover',exact:true}).click();await page.getByRole('button',{name:'Your text',exact:true}).click();const title='A long question about the comfort and hope that we carry with us through every season of life';await page.getByLabel('Title or question').fill(title);await page.getByLabel('Text to remember').fill('Grace and peace remain with you.');await page.getByRole('button',{name:'Add your text',exact:true}).click();await page.getByRole('button').filter({has:page.locator('b',{hasText:title})}).click();await page.keyboard.press('g');await expect(page.locator('.prompt')).toHaveClass(/collapsed/);await expect(page.locator('.prompt-title')).toHaveCSS('white-space','nowrap');await expect(page.locator('.added-toast')).toHaveCount(0);await shot(page,info,'short-practice');await page.locator('.prompt-title').click();await expect(page.locator('.prompt')).not.toHaveClass(/collapsed/);await page.locator('.prompt-title').click();for(const key of ['a','p','r','w','y'])await page.keyboard.press(key);const passed=page.getByRole('dialog',{name:'Step 1 passed',exact:true});await expect(passed).toBeVisible();await passed.getByRole('button',{name:'Close practice',exact:true}).click();await page.getByRole('button',{name:'Today',exact:true}).click();
 const contrast=await page.locator('.week-dots .done.today').evaluate(el=>{const css=getComputedStyle(el);const luminance=(value:string)=>{const c=value.match(/[\d.]+/g)!.slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return c[0]*.2126+c[1]*.7152+c[2]*.0722};const a=luminance(css.color),b=luminance(css.backgroundColor);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05)});expect(contrast).toBeGreaterThanOrEqual(4.5);await shot(page,info,'week-contrast');
});
