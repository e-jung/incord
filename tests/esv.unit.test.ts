import {afterEach,describe,expect,it,vi} from 'vitest';
import {handleEsv} from '../cloudflare/esv';
const request=(q='John 3:16')=>new Request('https://incord.test/api/esv?q='+encodeURIComponent(q));
const access=()=>({signedIn:vi.fn(async()=>false),anonymousAllowed:vi.fn(async()=>true)});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks()});
describe('ESV proxy',()=>{
 it('uses the secret only as authorization, requests no decorations, and returns exact text with no-store',async()=>{
  const exact='  A publisher’s exact quotation.\n\n';const fetch=vi.fn(async()=>Response.json({passages:[exact]}));vi.stubGlobal('fetch',fetch);const a=access();const result=await handleEsv(request(),{ESV_API_KEY:'test-only'},a);
  expect(await result.text()).toBe(exact);expect(result.headers.get('Cache-Control')).toContain('no-store');expect(result.headers.get('Content-Type')).toContain('text/plain');expect(a.anonymousAllowed).toHaveBeenCalledWith(30,3600);
  const [url,options]=fetch.mock.calls[0] as any;expect(url.origin+url.pathname).toBe('https://api.esv.org/v3/passage/text/');expect(url.searchParams.get('q')).toBe('John 3:16');for(const key of ['include-headings','include-footnotes','include-verse-numbers','include-short-copyright','include-passage-references'])expect(url.searchParams.get(key)).toBe('false');expect(options).toMatchObject({headers:{Authorization:'Token test-only'},redirect:'manual',cache:'no-store'});
 });
 it('allows validated sessions without anonymous allowance',async()=>{const a=access();a.signedIn.mockResolvedValue(true);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({passages:['text']})));expect((await handleEsv(request(),{ESV_API_KEY:'test'},a)).status).toBe(200);expect(a.anonymousAllowed).not.toHaveBeenCalled()});
 it('rejects throttled anonymous requests before contacting Crossway',async()=>{const a=access();a.anonymousAllowed.mockResolvedValue(false);const fetch=vi.fn();vi.stubGlobal('fetch',fetch);expect((await handleEsv(request(),{ESV_API_KEY:'test'},a)).status).toBe(429);expect(fetch).not.toHaveBeenCalled()});
 it('rejects non-GET, invalid references, and >500-verse requests',async()=>{const a=access();expect((await handleEsv(new Request(request(),{method:'POST'}),{},a)).status).toBe(405);for(const q of ['','love','John 3:16;Genesis 1:1','Fake 1','Genesis 1-50'])expect((await handleEsv(request(q),{},a)).status).toBe(400)});
 it('fails closed without a configured API key',async()=>{expect((await handleEsv(request(),{},access())).status).toBe(503)});
 it('never forwards publisher error bodies or redirect responses',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('secret error',{status:401})).mockResolvedValueOnce(new Response('',{status:302})).mockResolvedValueOnce(new Response('',{status:429})));for(const status of [502,502,429]){const result=await handleEsv(request(),{ESV_API_KEY:'test'},access());expect(result.status).toBe(status);expect(await result.text()).not.toContain('secret')}});
 it('rejects multiple/missing passages rather than altering the text',async()=>{for(const data of [{},{passages:[]},{passages:['a','b']},{passages:[' ']},{passages:[5]}]){vi.stubGlobal('fetch',vi.fn(async()=>Response.json(data)));expect((await handleEsv(request(),{ESV_API_KEY:'test'},access())).status).toBe(404)}});
 it('returns a generic non-cacheable error after network failure',async()=>{vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('sensitive')}));const result=await handleEsv(request(),{ESV_API_KEY:'test'},access());expect(result.status).toBe(502);expect(await result.text()).not.toContain('sensitive');expect(result.headers.get('Cache-Control')).toContain('no-store')});
});
