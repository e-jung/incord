import {test,expect,type Page,type TestInfo} from '@playwright/test';
import {mkdir} from 'node:fs/promises';

const shots='/home/ubuntu/.openclaw/workspace/reports/bible-memory-20261113/fix-5-screens';
async function shot(page:Page,info:TestInfo,name:string){
  await mkdir(shots,{recursive:true});
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:`${shots}/${info.project.name}-${name}.png`,animations:'disabled'});
}
async function documents(page:Page){
  await page.goto('/');
  await page.getByRole('button',{name:'Discover',exact:true}).click();
  await page.getByRole('button',{name:'Catechisms',exact:true}).click();
}
test('notifications expire, stay above navigation without covering content, and never follow navigation into practice',async({page},info)=>{
  await documents(page);
  await page.getByRole('combobox',{name:'Browse',exact:true}).selectOption({label:'Westminster Shorter Catechism'});
  await page.getByRole('button',{name:'Add Q1',exact:true}).click();
  const toast=page.locator('.added-toast');
  await expect(toast).toBeVisible();
  const notification=(await toast.boundingBox())!;
  const content=(await page.locator('.page').boundingBox())!;
  const nav=(await page.getByRole('navigation').boundingBox())!;
  expect(content.y+content.height).toBeLessThanOrEqual(notification.y);
  expect(notification.y+notification.height).toBeLessThanOrEqual(nav.y);
  await shot(page,info,'scoped-toast');
  await expect(toast).toHaveCount(0,{timeout:5000});
  await page.getByRole('button',{name:'Add Q2',exact:true}).click();
  await expect(toast).toBeVisible();
  await page.getByRole('button',{name:'Today',exact:true}).click();
  await expect(toast).toHaveCount(0);
  await page.getByRole('button',{name:'Begin',exact:true}).click();
  await expect(page.locator('.practice')).toBeVisible();
  await expect(page.locator('.added-toast,.undo-toast')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Show numbers',exact:true})).toHaveCount(0);
  await expect(page.locator('.keyboard .keyrow')).toHaveCount(4);
  await shot(page,info,'catechism-step-1');
  await page.getByRole('button',{name:'Close practice',exact:true}).click();
  await page.getByRole('button',{name:'Discover',exact:true}).click();
  await expect(toast).toHaveCount(0);
});
test('numeric tokens have a reversible digit keyboard with four rows and full-height targets',async({page},info)=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Discover',exact:true}).click();
  await page.getByRole('button',{name:'Your text',exact:true}).click();
  await page.getByLabel('Title or question').fill('Count the gifts');
  await page.getByLabel('Text to remember').fill('Give 12 thanks.');
  await page.getByRole('button',{name:'Add your text',exact:true}).click();
  await page.getByRole('button').filter({has:page.locator('b',{hasText:'Count the gifts'})}).click();
  const keyboard=page.getByLabel('Practice keyboard');
  const height=(await keyboard.boundingBox())!.height;
  expect(height).toBeLessThan(250);
  await expect(page.locator('.added-toast,.undo-toast')).toHaveCount(0);
  await shot(page,info,'numeric-letters');
  await keyboard.getByRole('button',{name:'G',exact:true}).click();
  await keyboard.getByRole('button',{name:'Show numbers',exact:true}).click();
  await expect(keyboard.locator('.number-key')).toHaveCount(10);
  await expect(keyboard.locator('.keyrow')).toHaveCount(4);
  expect((await keyboard.boundingBox())!.height).toBe(height);
  for(const button of await keyboard.getByRole('button').all())expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page,info,'numeric-digits');
  await keyboard.getByRole('button',{name:'1',exact:true}).click();
  await expect(page.locator('[data-word="2"]')).toHaveClass(/current/);
  await keyboard.getByRole('button',{name:'Show letters',exact:true}).click();
  await expect(keyboard.locator('.number-key')).toHaveCount(0);
  await keyboard.getByRole('button',{name:'T',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Step 1 passed',exact:true})).toBeVisible();
  await expect(page.locator('.added-toast,.undo-toast')).toHaveCount(0);
});
test('documents with at most 12 items offer only Add all; larger documents keep batch chips',async({page},info)=>{
  await documents(page);
  for(const [label,name,count] of [['Apostles’ Creed','apostles',1],['Nicene Creed','nicene',3]] as const){
    await page.getByRole('combobox',{name:'Browse',exact:true}).selectOption({label});
    await expect(page.locator('.bulk-actions button')).toHaveCount(count);
    await expect(page.locator('.bulk-actions').getByRole('button',{name:'Add all',exact:true})).toBeVisible();
    await shot(page,info,name);
  }
  await page.getByRole('combobox',{name:'Browse',exact:true}).selectOption({label:'Westminster Shorter Catechism'});
  await expect(page.locator('.bulk-actions button')).toHaveCount(3);
});
