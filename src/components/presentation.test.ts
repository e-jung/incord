import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import {chromium, type Browser} from '@playwright/test';
import {createServer, type ViteDevServer} from 'vite';
import {svelte} from '@sveltejs/vite-plugin-svelte';
import documents from '../../public/content/documents.json';

// Exercise the real Svelte component and CSS, independently of App's routing.
let server: ViteDevServer, browser: Browser, origin: string;
const cacheDir=`node_modules/.vite-presentation-${crypto.randomUUID()}`;
beforeAll(async()=>{
  server=await createServer({configFile:false,publicDir:false,cacheDir,plugins:[svelte()],appType:'custom',server:{host:'127.0.0.1',port:0}});
  server.middlewares.use((req,res,next)=>{
    if((req as {url?:string}).url!=='/')return next();
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><html><body><main class="practicing"><section class="practice"><header style="height:44px"></header><div class="prompt"><h1>Long passage</h1></div><div id="verse" style="display:contents"></div><div id="keys" style="display:contents"></div></section></main></body></html>');
  });
  await server.listen();
  origin=server.resolvedUrls!.local[0]!;
  browser=await chromium.launch({headless:true});
},30000);
afterAll(async()=>{await browser?.close();await server?.close()});
const passages=[documents.find(d=>d.id==='heidelberg')!.items[0]!.text,Array(120).fill('word').join(' ')];
describe('P0-1 current word stays above the keyboard',()=>{
  for(const theme of ['light','dark'])for(const reducedMotion of ['reduce','no-preference'] as const)for(const [passage,text] of passages.entries()){
    it(`${theme}, ${reducedMotion}, ${passage===0?'Heidelberg Q1':'120-word own text'}`,async()=>{
      const page=await browser.newPage({viewport:{width:393,height:852},reducedMotion});
      try{
        await page.goto(origin);
        await page.evaluate(async({text,theme,runtimePath})=>{
          const load=new Function('path','return import(path)') as (path:string)=>Promise<any>;
          await load('/src/app.css');await load('/src/tokens.css');
          const {mount,unmount}=await load(runtimePath);
          const {default:Verse}=await load('/src/components/VerseText.svelte');
          const {default:Keys}=await load('/src/components/Keyboard.svelte');
          const {tokenize}=await load('/src/engine/tokenize.ts');
          document.documentElement.dataset.theme=theme;
          (window as any).harness={mount,unmount,Verse,words:tokenize(text),text};
          mount(Keys,{target:document.querySelector('#keys'),props:{onkey:()=>{},onpeek:()=>{}}});
        },{text,theme,runtimePath:`/${cacheDir}/deps/svelte.js`});
        for(const target of [0,50,70,118]){
          const index=await page.evaluate(target=>{
            const h=(window as any).harness;
            if(h.instance)h.unmount(h.instance);
            const index=Math.min(target,h.words.length-1);
            h.instance=h.mount(h.Verse,{target:document.querySelector('#verse'),props:{words:h.words,text:h.text,mask:h.words.map(()=>false),index,slipped:index?[index-1]:[]}});
            return index;
          },target);
          await expect.poll(async()=>page.evaluate(index=>{
            const word=document.querySelector(`[data-word="${index}"]`)!.getBoundingClientRect();
            const view=document.querySelector('.verse')!.getBoundingClientRect();
            const keys=document.querySelector('.keyboard')!.getBoundingClientRect();
            return word.top>=view.top-1&&word.bottom<=view.bottom+1&&word.bottom<=keys.top;
          },index)).toBe(true);
        }
        expect(await page.locator('.verse .slip').count()).toBe(1);
        expect(await page.locator('.verse .slip').evaluate(el=>getComputedStyle(el).color)).toBe(theme==='light'?'rgb(153, 80, 13)':'rgb(231, 161, 99)');
        const dimensions=await page.locator('.number-key,.peek').evaluateAll(keys=>keys.map(key=>{const r=key.getBoundingClientRect();return [r.width,r.height]}));
        expect(dimensions.every(([width,height])=>width!>=44&&height!>=44)).toBe(true);
      }finally{await page.close()}
    },30000);
  }
});
