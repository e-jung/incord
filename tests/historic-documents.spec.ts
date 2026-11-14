import {test,expect,type Page} from '@playwright/test';

async function discover(page:Page){await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'Discover',exact:true}).click()}
async function openDocument(page:Page,title:string){await page.getByRole('button',{name:'Catechisms & creeds',exact:true}).click();await page.locator('.document-cards').getByRole('button',{name:new RegExp(title)}).click();return page.locator('#document-browser')}

test('document cards replace duplicate Catechisms mode and document selector; historic editions and per-question adds remain',async({page})=>{
 await discover(page);
 await expect(page.getByRole('button',{name:'Catechisms',exact:true})).toHaveCount(0);
 await expect(page.getByRole('combobox',{name:'Browse',exact:true})).toHaveCount(0);
 for(const [title,count,description] of [['Westminster Larger Catechism',196,'received American edition'],['Baptist Catechism',114,'Particular Baptist'],['Spurgeon',82,'Baptist adaptation'],['Catechism for Young Children',145,'introducing children']] as const){
  const browser=await openDocument(page,title);
  await expect(browser.locator('.document-intro')).toContainText(`${count} questions`);
  await expect(browser.locator('.document-intro')).toContainText(description);
 }
 const first=page.locator('.document-row').first();await expect(first).toContainText('Who made you?');await first.locator('summary').click();await expect(first.locator('p')).toHaveText('God.');await first.getByRole('button',{name:'Add Q1',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('button',{name:/^Catechism for Young Children 0 of 1 learned/}).click();await page.getByRole('button',{name:/^Who made you\?/}).click();await expect(page.getByLabel('Practice',{exact:true})).toBeFocused();await expect(page.locator('[data-word="0"]')).toHaveText('God.');
});

test('question range advances to the next twelve un-added questions and survives reopening',async({page})=>{
 await discover(page);const browser=await openDocument(page,'Westminster Shorter Catechism');
 for(const width of [320,393]){
  await page.setViewportSize({width,height:852});
  for(const control of await browser.locator('button,input').all())if(await control.isVisible()){
   const box=(await control.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width+.5);
  }
 }
 await expect(browser.getByLabel('From question',{exact:true})).toHaveValue('1');await expect(browser.getByLabel('Through question',{exact:true})).toHaveValue('12');
 await browser.getByRole('button',{name:'Add 12 items',exact:true}).click();
 await expect(browser.getByLabel('From question',{exact:true})).toHaveValue('13');await expect(browser.getByLabel('Through question',{exact:true})).toHaveValue('24');
 await page.getByRole('navigation').getByRole('button',{name:'Library',exact:true}).click();await expect(page.getByRole('button',{name:/Westminster Shorter Catechism 0 of 12 learned/})).toBeVisible();
 await page.getByRole('navigation').getByRole('button',{name:'Discover',exact:true}).click();await openDocument(page,'Westminster Shorter Catechism');await expect(browser.getByLabel('From question',{exact:true})).toHaveValue('13');
 await browser.getByRole('button',{name:'Add 12 items',exact:true}).click();await expect(browser.getByLabel('From question',{exact:true})).toHaveValue('25');
});

test('Heidelberg offers inclusive Lord’s Day ranges as well as question ranges',async({page})=>{
 await discover(page);const browser=await openDocument(page,'Heidelberg');
 await expect(browser.getByRole('button',{name:'Lord’s Day range',exact:true})).toHaveAttribute('aria-pressed','true');
 await expect(browser.getByLabel('Through Lord’s Day',{exact:true})).toHaveValue('4');
 await browser.getByLabel('Through Lord’s Day',{exact:true}).fill('2');await expect(browser.getByRole('status')).toContainText('5 questions');await browser.getByRole('button',{name:'Add 5 items',exact:true}).click();
 await expect(browser.getByLabel('From Lord’s Day',{exact:true})).toHaveValue('3');
 await browser.getByRole('button',{name:'Question range',exact:true}).click();await expect(browser.getByLabel('From question',{exact:true})).toHaveValue('6');
});

test('inclusive question range retains all long-answer parts and rejects invalid ranges',async({page})=>{
 await discover(page);const browser=await openDocument(page,'Westminster Larger Catechism');
 await browser.getByLabel('From question',{exact:true}).fill('99');await browser.getByLabel('Through question',{exact:true}).fill('99');
 await expect(browser.getByRole('status')).toHaveText('1 question · 2 practice items');await browser.getByRole('button',{name:'Add 2 items',exact:true}).click();
 await expect(browser.getByRole('button',{name:'Added to your library.',exact:true})).toHaveCount(2);
 await browser.getByLabel('From question',{exact:true}).fill('10');await browser.getByLabel('Through question',{exact:true}).fill('9');await expect(browser.getByRole('alert')).toBeVisible();await expect(browser.getByRole('button',{name:'Choose a range',exact:true})).toBeDisabled();
});

test('creeds retain all articles, whole-document adding and added-state deduplication',async({page})=>{
 await discover(page);const browser=await openDocument(page,'Nicene Creed');
 await browser.getByRole('button',{name:'Whole document',exact:true}).click();await expect(browser.getByRole('status')).toHaveText('17 articles');await browser.getByRole('button',{name:'Add 17 items',exact:true}).click();
 await expect(browser.getByRole('button',{name:'Already in your library.',exact:true})).toBeDisabled();await expect(browser.getByRole('button',{name:'Added to your library.',exact:true})).toHaveCount(17);
});

test('large whole documents use the existing batch confirmation and cancellation preserves the library',async({page})=>{
 await discover(page);const browser=await openDocument(page,'Westminster Shorter Catechism');await browser.getByRole('button',{name:'Whole document',exact:true}).click();await browser.getByRole('button',{name:'Add 107 items',exact:true}).click();
 const sheet=page.locator('.sheet');await expect(sheet).toBeVisible();await sheet.getByRole('button',{name:'Cancel',exact:true}).click();await expect(browser.getByRole('button',{name:'Added to your library.',exact:true})).toHaveCount(0);
});
