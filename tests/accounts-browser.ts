import {expect,type BrowserContext,type Route} from '@playwright/test';
type Scenario={email?:string;sso?:'present'|'none'};
const scenarios=new WeakMap<BrowserContext,Scenario>();
const installed=new WeakSet<BrowserContext>();
export function accountsScenario(context:BrowserContext,scenario:Scenario){scenarios.set(context,scenario)}
// Playwright does not route subsequent URLs in an HTTP redirect chain. A tiny
// test-only refresh document starts a fresh top-level navigation at each hop,
// so the fake public host is always intercepted (never contacted on the network).
async function redirectDocument(route:Route,location:string){
 await route.fulfill({status:200,contentType:'text/html',headers:{'cache-control':'no-store'},body:'<meta http-equiv="refresh" content="0;url='+location.replaceAll('&','&amp;').replaceAll('"','&quot;')+'">'});
}
/** Only the public navigation host is faked; all Incord API/PKCE/registry/session work is real. */
export async function installAccountsBrowser(context:BrowserContext,baseURL:string){
 if(installed.has(context))return;installed.add(context);
 let challengeCookie='';
 await context.route(/\/(?:api\/auth\/jesklabs(?:\?.*|\/.*)?|auth\/jesklabs\/callback(?:\?.*)?)$/,async route=>{
  // WebKit rejects Secure __Host cookies on HTTP loopback. Carry the actual
  // server-issued opaque binding in this browser-context-local test transport.
  // No challenge, PKCE, same-origin, session or cookie security code is changed.
  const req=route.request(),headers={...req.headers()};
  if(challengeCookie&&new URL(baseURL).protocol==='http:')headers.cookie=[headers.cookie,challengeCookie].filter(Boolean).join('; ');
  const response=await route.fetch({headers,maxRedirects:0});
  for(const cookie of response.headersArray().filter(header=>header.name.toLowerCase()==='set-cookie').map(header=>header.value)){
   expect(cookie).not.toMatch(/Domain=/i);
   if(cookie.startsWith('__Host-jl_auth='))challengeCookie=cookie.split(';')[0];
   if(cookie.startsWith('bh_session=')){const pair=cookie.split(';')[0],value=pair.slice('bh_session='.length);await context.addCookies([{name:'bh_session',value,url:baseURL,httpOnly:/HttpOnly/i.test(cookie),secure:/;\s*Secure/i.test(cookie),sameSite:'Lax'}])}
  }
  if(response.headers().location)await redirectDocument(route,new URL(response.headers().location,req.url()).href);
  else {const headers=response.headers();delete headers['set-cookie'];await route.fulfill({response,headers})}
 });
 await context.route('https://accounts.jesklabs.com/**',async route=>{
  const req=route.request();expect(req.resourceType(),'Accounts hops must be documents, never client fetch').toBe('document');expect(req.method()).toBe('GET');
  const url=new URL(req.url()),scenario=scenarios.get(context)||{};
  if(url.pathname==='/authorize'){
   url.searchParams.set('__test_sso',scenario.sso||'none');
   if(scenario.email)url.searchParams.set('__test_email',scenario.email);
  }
  const response=await context.request.get(new URL('/__test/accounts'+url.pathname+url.search,baseURL).href,{maxRedirects:0});
  if(url.pathname==='/sso/attach'&&response.ok()){
   const {returnPath}=await response.json();await redirectDocument(route,new URL(returnPath,baseURL).href);
  }else if(response.headers().location)await redirectDocument(route,response.headers().location);
  else await route.fulfill({response});
 });
}
