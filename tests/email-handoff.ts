import {expect,type Page} from '@playwright/test';
/** Complete the real top-level email attach handoff before inspecting Settings. */
export async function waitEmailHandoff(page:Page,code:string){
 const origin=new URL(page.url()).origin;
 const returned=page.waitForResponse(response=>{const url=new URL(response.url());return url.origin===origin&&url.pathname==='/'&&url.searchParams.get('signedIn')==='1'&&response.request().isNavigationRequest()});
 await page.getByLabel('Six-digit code').fill(code);await returned;
 await page.waitForURL(url=>url.origin===origin&&url.pathname==='/'&&url.searchParams.get('signedIn')==='1',{waitUntil:'domcontentloaded'});
}
export async function finishEmailSignin(page:Page,code:string,beforeSettings?:()=>Promise<void>){
 await waitEmailHandoff(page,code);
 if(beforeSettings)await beforeSettings();
 await page.getByRole('button',{name:'Account settings',exact:true}).click();
 await expect(page.getByText('Signed in.',{exact:true})).toBeVisible();
}
