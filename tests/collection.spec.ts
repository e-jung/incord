import {test,expect} from '@playwright/test';
test('add an item inside an existing collection, practice it and remove it',async({page})=>{
 await page.goto('/');
 await page.getByRole('navigation').getByRole('button',{name:'Library',exact:true}).click();
 await page.locator('.cover').filter({has:page.locator('b',{hasText:'Psalm 23'})}).click();
 await expect(page.getByRole('heading',{level:1,name:'Psalm 23',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Add items',exact:true}).click();
 await page.getByRole('button',{name:'Your own text',exact:true}).click();
 await page.getByLabel('Title or question').fill('A collected word');
 await page.getByLabel('Text to remember').fill('Grace remains with us.');
 await page.getByRole('button',{name:'Add your text',exact:true}).click();
 await page.getByRole('button',{name:/Psalm 23.*0 of 7 learned/}).click();
 await page.getByRole('button').filter({has:page.locator('b',{hasText:'A collected word'})}).click();
 await expect(page.getByRole('heading',{level:1,name:'A collected word',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Close practice',exact:true}).click();
 await page.getByRole('button',{name:'Remove A collected word',exact:true}).click();
 await expect(page.getByRole('button',{name:'Remove A collected word',exact:true})).toHaveCount(0);
});
