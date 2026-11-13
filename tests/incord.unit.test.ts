import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import worker, { RegistryDO, UserDO, b64, type Env } from '../cloudflare/worker';

const oldOrigin = 'https://byheart.jesklabs.com';
const newOrigin = 'https://incord.jesklabs.com';
function fixture() {
 const db = new DatabaseSync(':memory:');
 const state = {storage:{sql:{exec(query:string,...args:any[]){const s=db.prepare(query);return s.columns().length?s.all(...args):(s.run(...args),[])}},transactionSync:(fn:()=>unknown)=>fn()},blockConcurrencyWhile:(fn:()=>unknown)=>fn()} as unknown as DurableObjectState;
 const registry = new RegistryDO(state);
 const assets = vi.fn(async()=>new Response('<h1>Incord</h1>',{headers:{'Content-Type':'text/html'}}));
 const env={SESSION_SECRET:'migration-unit-test-secret-over-32-characters',ASSETS:{fetch:assets},REGISTRY:{idFromName:(id:string)=>id,get:()=>({fetch:(url:string,init:RequestInit)=>registry.fetch(new Request(url,init))})}} as unknown as Env;
 return {env,assets,db};
}
const post = (origin:string,path:string,data:unknown={},cookie?:string)=>new Request(origin+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});

describe('FIX-7 migration responses',()=>{
 it.each(['/','/library?source=installed','/assets/old.js?version=1','/manifest.webmanifest'])('permanently redirects old host %s preserving path and query',async path=>{
  const {env,assets}=fixture();const response=await worker.fetch(new Request(oldOrigin+path),env);
  expect(response.status).toBe(301);expect(response.headers.get('Location')).toBe(newOrigin+path);expect(assets).not.toHaveBeenCalled();expect(response.headers.get('Strict-Transport-Security')).toBeTruthy();
 });
 it.each(['GET','POST','DELETE'])('retires old API with 410, not a cross-origin write redirect (%s)',async method=>{
  const {env,assets}=fixture();const response=await worker.fetch(new Request(oldOrigin+'/api/sync',{method}),env);
  expect(response.status).toBe(410);expect(response.headers.get('Location')).toBeNull();expect(await response.json()).toMatchObject({error:expect.stringContaining(newOrigin)});expect(assets).not.toHaveBeenCalled();
 });
 it('serves only the new HTTPS origin in the old RP related-origin document',async()=>{
  const {env,assets}=fixture();const response=await worker.fetch(new Request(oldOrigin+'/.well-known/webauthn'),env);
  expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toContain('application/json');expect(await response.json()).toEqual({origins:[newOrigin]});expect(assets).not.toHaveBeenCalled();
 });
 it('serves an uncached self-unregistering old worker with navigation migration',async()=>{
  const {env,assets}=fixture();const response=await worker.fetch(new Request(oldOrigin+'/sw.js'),env);const script=await response.text();
  expect(response.status).toBe(200);expect(response.headers.get('Content-Type')).toContain('javascript');expect(response.headers.get('Cache-Control')).toContain('no-store');expect(response.headers.get('Service-Worker-Allowed')).toBe('/');expect(script).toContain('skipWaiting');expect(script).toContain('registration.unregister()');expect(script).toContain('client.navigate');expect(script).toContain("url.hostname='incord.jesklabs.com'");expect(assets).not.toHaveBeenCalled();
 });
 it('does not redirect similar-looking hosts or intercept new-origin assets',async()=>{
  const {env,assets}=fixture();for(const origin of [newOrigin,'https://byheart.jesklabs.com.evil.test']){const response=await worker.fetch(new Request(origin+'/'),env);expect(response.status).toBe(200);expect(await response.text()).toContain('Incord')}
  expect(assets).toHaveBeenCalledTimes(2);
 });
 it.each([[newOrigin,{},'incord.jesklabs.com'],[newOrigin,{legacy:true},'byheart.jesklabs.com'],[newOrigin,{legacy:'true'},'incord.jesklabs.com'],['https://localhost',{legacy:true},'localhost'],['https://evil.test',{legacy:true},'evil.test']])('binds login options and stored one-use challenge to selected RP: %s %j',async(origin,input,rp)=>{
  const {env,db}=fixture();const response=await worker.fetch(post(origin as string,'/api/auth/login/options',input),env);expect(response.status).toBe(200);
  const options=await response.json<any>();expect(options.rpId).toBe(rp);
  const stored=JSON.parse(String(db.prepare('SELECT value FROM challenges').get()!.value));expect(stored).toMatchObject({kind:'login',rpID:rp,challenge:options.challenge});
 });
 it('still rejects cross-origin legacy-option requests before creating a challenge',async()=>{
  const {env,db}=fixture();const request=post(newOrigin,'/api/auth/login/options',{legacy:true});request.headers.set('Origin',oldOrigin);
  expect((await worker.fetch(request,env)).status).toBe(403);expect(db.prepare('SELECT COUNT(*) AS n FROM challenges').get()!.n).toBe(0);
 });
});

// Valid ES256 signatures exercise the real verifier, not a mocked WebAuthn result.
async function signedLoginFixture() {
 const f=fixture(); const uid='11111111-1111-4111-8111-111111111111';
 const db=new DatabaseSync(':memory:');
 const state={id:{toString:()=>uid},storage:{sql:{exec(query:string,...args:any[]){const s=db.prepare(query);return s.columns().length?s.all(...args):(s.run(...args),[])}},transactionSync:(fn:()=>unknown)=>fn()},blockConcurrencyWhile:(fn:()=>unknown)=>fn()} as unknown as DurableObjectState;
 const user=new UserDO(state,f.env);
 f.env.USERS={idFromName:(id:string)=>id,get:()=>({fetch:(url:string,init:RequestInit)=>user.fetch(new Request(url,init))})} as unknown as DurableObjectNamespace;
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const jwk=publicKey.export({format:'jwk'});
 const cose=Buffer.concat([Buffer.from([0xa5,1,2,3,0x26,0x20,1,0x21,0x58,0x20]),Buffer.from(jwk.x!,'base64url'),Buffer.from([0x22,0x58,0x20]),Buffer.from(jwk.y!,'base64url')]);
 const id=b64(crypto.getRandomValues(new Uint8Array(32)));
 await user.fetch(post('https://internal','/credential/add',{name:'Migrated friend',credential:{id,publicKey:b64(cose),counter:0,rpID:'byheart.jesklabs.com'}}));
 const registry=f.env.REGISTRY.get(f.env.REGISTRY.idFromName('registry'));
 await registry.fetch('https://internal/credential/set',{method:'POST',body:JSON.stringify({id,uid})});
 const assertion=(challenge:string,rpID:string,origin=newOrigin)=>{
  const clientDataJSON=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,origin,crossOrigin:false}));
  const authenticatorData=Buffer.concat([createHash('sha256').update(rpID).digest(),Buffer.from([5,0,0,0,1])]);
  const signature=sign('sha256',Buffer.concat([authenticatorData,createHash('sha256').update(clientDataJSON).digest()]),privateKey);
  return {id,rawId:id,type:'public-key',response:{clientDataJSON:b64(clientDataJSON),authenticatorData:b64(authenticatorData),signature:b64(signature),userHandle:null},clientExtensionResults:{},authenticatorAttachment:'platform'};
 };
 return {...f,assertion};
}
describe('FIX-7 legacy RP cryptographic binding',()=>{
 it.each([false,true])('accepts a signed assertion only for the flow-selected RP (legacy=%s), then consumes challenge',async legacy=>{
  const {env,assertion}=await signedLoginFixture();
  const optionsResponse=await worker.fetch(post(newOrigin,'/api/auth/login/options',{legacy}),env);const options=await optionsResponse.json<any>();const cookie=optionsResponse.headers.get('set-cookie')!.split(';')[0];
  const response=assertion(options.challenge,options.rpId);
  const result=await worker.fetch(post(newOrigin,'/api/auth/login/verify',{response},cookie),env);
  expect(result.status).toBe(200);expect(await result.json()).toMatchObject({legacyPasskey:legacy,user:{displayName:'Migrated friend'}});expect(result.headers.get('set-cookie')).toContain('Secure');
  expect((await worker.fetch(post(newOrigin,'/api/auth/login/verify',{response},cookie),env)).status).toBe(400);
 });
 it.each([false,true])('rejects correctly signed wrong-RP assertions despite a caller legacy override (legacy=%s)',async legacy=>{
  const {env,assertion}=await signedLoginFixture();const optionsResponse=await worker.fetch(post(newOrigin,'/api/auth/login/options',{legacy}),env);const options=await optionsResponse.json<any>();const cookie=optionsResponse.headers.get('set-cookie')!.split(';')[0];
  const response=assertion(options.challenge,legacy?'incord.jesklabs.com':'byheart.jesklabs.com');
  expect((await worker.fetch(post(newOrigin,'/api/auth/login/verify',{response,legacy:!legacy,rpID:legacy?'incord.jesklabs.com':'byheart.jesklabs.com'},cookie),env)).status).toBe(401);
 });
 it('rejects a valid old-RP signature made at the old origin, even in migration flow',async()=>{
  const {env,assertion}=await signedLoginFixture();const optionsResponse=await worker.fetch(post(newOrigin,'/api/auth/login/options',{legacy:true}),env);const options=await optionsResponse.json<any>();const cookie=optionsResponse.headers.get('set-cookie')!.split(';')[0];
  const response=assertion(options.challenge,options.rpId,oldOrigin);expect((await worker.fetch(post(newOrigin,'/api/auth/login/verify',{response},cookie),env)).status).toBe(401);
 });
});
