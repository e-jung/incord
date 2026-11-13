import { test, expect, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { mkdir } from 'node:fs/promises';
import worker, { RegistryDO, UserDO, StatsDO, type Env } from '../cloudflare/worker';

const origin='https://incord.jesklabs.com';
const statsToken='fix7-browser-local-stats-token-32-characters';
function state(id='migration-fixture') {
 const db=new DatabaseSync(':memory:');const kv=new Map<string,unknown>();
 const storage:any={get:async(key:string)=>kv.get(key),put:async(key:string,value:unknown)=>{kv.set(key,value)},delete:async(keys:string|string[])=>{for(const key of Array.isArray(keys)?keys:[keys])kv.delete(key)},list:async(options:{prefix?:string}={})=>new Map([...kv].filter(([key])=>key.startsWith(options.prefix||''))),setAlarm:async()=>{},transaction:async(fn:(tx:any)=>unknown)=>fn(storage)};
 return {id:{toString:()=>id},storage:{...storage,sql:{exec(query:string,...args:any[]){const s=db.prepare(query);return s.columns().length?s.all(...args):(s.run(...args),[])}},transactionSync:(fn:()=>unknown)=>fn()},blockConcurrencyWhile:(fn:()=>unknown)=>fn()} as unknown as DurableObjectState;
}
async function workerFixture(page:Page) {
 const env={SESSION_SECRET:'fix7-browser-local-session-secret-32-characters',STATS_TOKEN:statsToken} as Env;
 const registry=new RegistryDO(state()),stats=new StatsDO(state()),users=new Map<string,UserDO>();
 const namespace=(resolve:(id:string)=>{fetch:(request:Request)=>Promise<Response>})=>({idFromName:(id:string)=>id,get:(id:string)=>({fetch:(url:string,init:RequestInit)=>resolve(id).fetch(new Request(url,init))})}) as unknown as DurableObjectNamespace;
 env.REGISTRY=namespace(()=>registry);env.STATS=namespace(()=>stats);env.USERS=namespace(id=>{if(!users.has(id))users.set(id,new UserDO(state(id),env));return users.get(id)!});
 env.ASSETS={fetch:async()=>new Response('<!doctype html><title>WebAuthn origin fixture</title><h1>WebAuthn origin fixture</h1>',{headers:{'Content-Type':'text/html'}})} as Fetcher;
 await page.route(origin+'/**',async route=>{
  const r=route.request();const response=await worker.fetch(new Request(r.url(),{method:r.method(),headers:await r.allHeaders(),...(r.postData()?{body:r.postData()!}:{})}),env);
  await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
 });
 return env;
}
async function api(page:Page,path:string,input:unknown){return page.evaluate(async({path,input})=>{const r=await fetch('/api'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});return {status:r.status,data:await r.json()}},{path,input})}
async function credential(page:Page,kind:'register'|'login',options:any){return page.evaluate(async({kind,options})=>{
 const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
 const publicKey={...options,challenge:decode(options.challenge)};
 if(kind==='register'){publicKey.user={...options.user,id:decode(options.user.id)};publicKey.excludeCredentials=(options.excludeCredentials||[]).map((c:any)=>({...c,id:decode(c.id)}))}else publicKey.allowCredentials=(options.allowCredentials||[]).map((c:any)=>({...c,id:decode(c.id)}));
 const result=kind==='register'?await navigator.credentials.create({publicKey}):await navigator.credentials.get({publicKey});return (result as any).toJSON();
 },{kind,options})}
test.describe('FIX-7 secure-origin worker integration',()=>{
 test.use({serviceWorkers:'block'});
 test('new Incord RP registers and signs in using a real Chromium virtual authenticator',async({page})=>{
  await workerFixture(page);await page.goto(origin);
  const cdp=await page.context().newCDPSession(page);await cdp.send('WebAuthn.enable');
  const {authenticatorId}=await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  const registration=await api(page,'/auth/register/options',{displayName:'Migration QA'});expect(registration.status).toBe(200);expect(registration.data.rp.id).toBe('incord.jesklabs.com');
  const registered=await api(page,'/auth/register/verify',{response:await credential(page,'register',registration.data)});expect(registered.status,JSON.stringify(registered.data)).toBe(200);expect(registered.data.user.hasIncordPasskey).toBe(true);
  const device=await cdp.send('WebAuthn.getCredentials',{authenticatorId});expect(device.credentials[0].rpId).toBe('incord.jesklabs.com');
  await api(page,'/auth/logout',{});
  const login=await api(page,'/auth/login/options',{});expect(login.data.rpId).toBe('incord.jesklabs.com');
  const response=await credential(page,'login',login.data);const signedIn=await api(page,'/auth/login/verify',{response});expect(signedIn.status).toBe(200);expect(signedIn.data).toMatchObject({legacyPasskey:false,user:{id:registered.data.user.id}});
  expect((await api(page,'/auth/login/verify',{response})).status).toBe(400);
  const legacy=await api(page,'/auth/login/options',{legacy:true});expect(legacy.data.rpId).toBe('byheart.jesklabs.com');
  // The real browser must not silently use the new-RP credential for an old-RP flow.
  const wrongRP=await credential(page,'login',{...legacy.data,rpId:'incord.jesklabs.com'});
  expect((await api(page,'/auth/login/verify',{response:wrongRP})).status).toBe(401);
 });
 test('private counts HTML form submits from its protected same-origin page',async({page})=>{
  await workerFixture(page);await page.goto(origin+'/stats');await page.getByLabel('Stats token').fill(statsToken);await page.getByRole('button',{name:'View counts'}).click();await expect(page.getByRole('heading',{name:'Incord · Private counts'})).toBeVisible({timeout:2000});
 });
 test('private counts requires token, uses a scoped HttpOnly cookie and renders aggregate dashboard',async({page},info)=>{
  const env=await workerFixture(page);await page.goto(origin+'/stats');await expect(page.getByRole('heading',{name:'Private counts',exact:true})).toBeVisible();
  const login=(token:string)=>worker.fetch(new Request(origin+'/stats',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token})}),env);
  expect((await login('wrong')).status).toBe(401);const authenticated=await login(statsToken);expect(authenticated.status).toBe(303);const value=authenticated.headers.get('set-cookie')!.split(';')[0].slice('incord_stats='.length);
  await page.context().addCookies([{name:'incord_stats',value,domain:'incord.jesklabs.com',path:'/stats',httpOnly:true,secure:true,sameSite:'Strict'}]);await page.goto(origin+'/stats');await expect(page.getByRole('heading',{name:'Incord · Private counts'})).toBeVisible();
  const cookie=(await page.context().cookies()).find(c=>c.name==='incord_stats')!;expect(cookie).toMatchObject({httpOnly:true,secure:true,sameSite:'Strict',path:'/stats'});expect(page.url()).not.toContain(statsToken);
  await shot(page,info.project.name,'stats');const logout=await worker.fetch(new Request(origin+'/stats/logout',{method:'POST',headers:{Origin:origin}}),env);expect(logout.status).toBe(303);expect(logout.headers.get('set-cookie')).toContain('Max-Age=0');await page.context().clearCookies();await page.goto(origin+'/stats');await expect(page.getByLabel('Stats token')).toBeVisible();
 });
});
async function shot(page:Page,project:string,name:string){await page.evaluate(()=>document.fonts.ready);await mkdir('fix-7-screens',{recursive:true});await page.screenshot({path:`fix-7-screens/${project}-${name}.png`})}
const tab=async(page:Page,name:string)=>page.getByRole('navigation').getByRole('button',{name,exact:true}).click();
test.describe('FIX-7 UI migration evidence',()=>{
 test.use({serviceWorkers:'block'});
 test('About, privacy opt-out, new icon, Discover ESV and practice attribution',async({page},info)=>{
  await page.route('**/api/esv?*',route=>route.fulfill({contentType:'text/plain',body:'The LORD is my shepherd; I shall not want.'}));
  await page.route('**/api/config',route=>route.fulfill({json:{passkeys:true}}));await page.route('**/api/me',route=>route.fulfill({json:{user:null}}));await page.route('**/api/stats',route=>route.fulfill({json:{ok:true}}));
  await page.goto('/');await page.getByRole('button',{name:'Account settings',exact:true}).click();
  const about=page.getByRole('region',{name:'About',exact:true});await expect(about).toContainText('Incord');await expect(about).toContainText('Crossway');await about.scrollIntoViewIfNeeded();await shot(page,info.project.name,'about');
  const privacy=page.getByRole('checkbox',{name:'Share anonymous usage counts'});await privacy.scrollIntoViewIfNeeded();await privacy.uncheck();await expect(privacy).not.toBeChecked();expect(await page.evaluate(()=>localStorage.getItem('incord.stats.enabled'))).toBe('0');await shot(page,info.project.name,'privacy');
  await tab(page,'Discover');await page.getByRole('combobox',{name:'Translation',exact:true}).selectOption('ESV');await page.getByLabel('Bible reference',{exact:true}).fill('Psalm 23:1');await page.getByRole('button',{name:'Find verses',exact:true}).click();
  await expect(page.getByText('The LORD is my shepherd; I shall not want.',{exact:true})).toBeVisible();await expect(page.locator('.esv-attribution').first().getByRole('link',{name:'ESV',exact:true})).toHaveAttribute('href','https://www.esv.org');await shot(page,info.project.name,'discover-esv');
  await page.getByRole('button',{name:'Add to library',exact:true}).click();await tab(page,'Library');await page.getByRole('button',{name:/^My verses 0 of 1 learned/}).click();await page.getByRole('button').filter({has:page.locator('b',{hasText:'Psalm 23:1'})}).click();
  await expect(page.locator('.practice .esv-attribution').getByRole('link',{name:'ESV',exact:true})).toHaveAttribute('href','https://www.esv.org');await shot(page,info.project.name,'practice-attribution');
  await page.goto('/icon.svg');await expect(page.locator('svg')).toBeVisible();await shot(page,info.project.name,'new-icon');
 });
});
