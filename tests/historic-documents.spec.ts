import {test,expect} from '@playwright/test';

test('historic catechisms show editions, original question counts and descriptions, and Engles can be practiced',async({page})=>{
 await page.goto('/');await page.getByRole('navigation').getByRole('button',{name:'Discover',exact:true}).click();await page.getByRole('button',{name:'Catechisms',exact:true}).click();
 const browse=page.getByRole('combobox',{name:'Browse',exact:true});
 for(const [id,count,description] of [['wlc',196,'received American edition'],['baptist',114,'Particular Baptist'],['spurgeon',82,'Baptist adaptation'],['young-children',145,'introducing children']] as const){
  await expect(browse.locator(`option[value="${id}"]`)).toContainText(`${count} questions`);await browse.selectOption(id);
  await expect(page.locator('.document-intro')).toContainText(`${count} questions`);await expect(page.locator('.document-intro')).toContainText(description);
 }
 const first=page.locator('.document-row').first();await expect(first).toContainText('Who made you?');await first.locator('summary').click();await expect(first.locator('p')).toHaveText('God.');await first.getByRole('button',{name:'Add Q1',exact:true}).click();
 await page.getByRole('navigation').getByRole('button',{name:'Library',exact:true}).click();await page.getByRole('button',{name:/^Catechism for Young Children 0 of 1 learned/}).click();await page.getByRole('button',{name:/^Who made you\?/}).click();await expect(page.getByLabel('Practice',{exact:true})).toBeFocused();await expect(page.locator('[data-word="0"]')).toHaveText('God.');
});
