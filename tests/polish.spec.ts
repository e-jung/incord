import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const sha=execFileSync('git',['rev-parse','--short','HEAD']).toString().trim();
async function shot(page:Page,info:TestInfo,name:string){await page.evaluate(()=>document.fonts.ready);await mkdir('test-results/screens/qa8',{recursive:true});await page.screenshot({path:`test-results/screens/qa8/${info.project.name}-${name}.png`,animations:'disabled'});}
test.use({serviceWorkers:'block'});
test('ESV source links stay with references in Discover, Library, Practice and Learned; About shows build HEAD',async({page},info)=>{
 await page.route('**/api/esv?*',route=>route.fulfill({contentType:'text/plain',body:'The LORD is my shepherd; I shall not want.'}));
 await page.goto('/');await page.getByRole('button',{name:'Account settings',exact:true}).click();
 const about=page.getByRole('region',{name:'About',exact:true});await expect(about).toContainText(sha);await expect(about.getByRole('link',{name:'esv.org',exact:true})).toBeVisible();await about.scrollIntoViewIfNeeded();await shot(page,info,'about');
 await page.getByRole('button',{name:'Discover',exact:true}).click();await page.getByRole('button', { name: 'Add your own', exact: true }).click();await page.getByRole('combobox',{name:'Default translation',exact:true}).selectOption('ESV');await page.getByLabel('Bible reference',{exact:true}).fill('Psalm 23:1');await page.getByRole('button',{name:'Find verses',exact:true}).click();
 const found=page.locator('.source-row');await expect(found.getByRole('link',{name:'ESV',exact:true})).toHaveAttribute('href','https://www.esv.org');await expect(page.locator('.esv-attribution')).toHaveCount(1);await shot(page,info,'discover-esv');
 await page.getByRole('button',{name:'Add to library',exact:true}).click();await page.getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('button',{name:/^My verses 0 of 1 learned/}).click();
 await expect(page.locator('.source-row').getByRole('link',{name:'ESV',exact:true})).toBeVisible();expect(await page.locator('button a').count()).toBe(0);expect(await page.locator('.row-title').evaluate(el=>getComputedStyle(el).color)).toBe(await page.locator('.source-row').evaluate(el=>getComputedStyle(el).color));await shot(page,info,'library-esv');
 await page.getByRole('button').filter({has:page.locator('b',{hasText:'Psalm 23:1'})}).click();
 await expect(page.locator('.prompt .esv-attribution')).toBeVisible();await expect(page.locator('.practice>.esv-attribution')).toHaveCount(0);await shot(page,info,'practice-attribution');
 await page.getByRole('button',{name:'I know this',exact:true}).click();
 for(const word of await page.locator('[data-word]').allTextContents())await page.keyboard.press(word.replace(/^[^\p{L}\p{N}]+/u,'')[0].toLowerCase());
 await expect(page.locator('.learned')).toBeVisible();await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(page.locator('.keepsake footer .esv-attribution')).toBeVisible();await shot(page,info,'learned-esv');
});
test('stats uses app fonts and theme, newest-first days and card-scoped horizontal scrolling at 393px',async({page},info)=>{
 await page.goto('/stats');await page.getByLabel('Stats token').fill('incord-playwright-local-stats-token-32chars');await page.getByRole('button',{name:'View counts'}).click();
 await expect(page.locator('.summary')).toBeVisible();await page.evaluate(()=>document.fonts.ready);
 expect(await page.evaluate(()=>document.fonts.check('16px Figtree'))).toBe(true);
 expect(await page.locator('h1').evaluate(el=>getComputedStyle(el).fontFamily)).toContain('Figtree');
 const dates=await page.locator('[aria-label="Daily activity"] tr td:first-child').allTextContents();expect(dates).toHaveLength(30);expect(dates).toEqual([...dates].sort().reverse());
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
 const scroll=page.getByRole('region',{name:'Daily activity',exact:true});expect(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
 expect(await scroll.locator('table').evaluate(el=>getComputedStyle(el).fontVariantNumeric)).toBe('tabular-nums');
 expect(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor)).toBe(info.project.name.endsWith('dark')?'rgb(8, 9, 11)':'rgb(236, 238, 242)');
 await shot(page,info,'stats');await scroll.evaluate(el=>el.scrollLeft=el.scrollWidth);expect(await scroll.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);await shot(page,info,'stats-scrolled');
});
