import {test,expect} from '@playwright/test';
test.use({serviceWorkers:'block'});
test('support is absent when unset and never leaks from About into Discover, previews or practice',async({page})=>{
 let donateUrl:string|null=null;
 await page.route('**/api/config',async route=>{const response=await route.fetch();await route.fulfill({response,json:{...await response.json(),donateUrl}})});
 await page.goto('/');await page.getByRole('button',{name:'Account settings',exact:true}).click();await expect(page.getByRole('link',{name:'Support Incord',exact:true})).toHaveCount(0);
 await page.route('**/api/esv?**',route=>route.fulfill({contentType:'text/plain',body:'The LORD is my shepherd; I shall not want.'}));
 donateUrl='https://example.org/support';await page.reload();await page.getByRole('button',{name:'Account settings',exact:true}).click();const link=page.getByRole('link',{name:'Support Incord',exact:true});await expect(link).toHaveAttribute('href',donateUrl);await expect(page.getByRole('region',{name:'About',exact:true}).getByRole('link',{name:'Support Incord',exact:true})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'Discover',exact:true}).click();await expect(link).toHaveCount(0);await page.getByRole('combobox',{name:'Default translation',exact:true}).selectOption('ESV');await page.locator('.featured-cards').getByRole('button',{name:/^Psalm 23/}).click();await expect(page.getByRole('dialog')).toBeVisible();await expect(link).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:'Add to my library',exact:true}).click();await page.getByRole('button',{name:'Start practice',exact:true}).click();await expect(page.getByRole('region',{name:'Practice',exact:true})).toBeVisible();await expect(link).toHaveCount(0);
});
test('Connect uses the optional instance URL without showing an unset link',async({page})=>{
 await page.route('**/api/config',route=>route.fulfill({json:{donateUrl:null}}));await page.goto('/connect');await expect(page.getByRole('link',{name:'Support Incord',exact:true})).toHaveCount(0);
 await page.unroute('**/api/config');await page.route('**/api/config',route=>route.fulfill({json:{donateUrl:'https://example.org/support'}}));await page.reload();await expect(page.getByRole('link',{name:'Support Incord',exact:true})).toHaveAttribute('href','https://example.org/support');
});
