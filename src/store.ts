import {settingsDefaults,loadSettings,migrateSettings,stampSettings,mergeSettings as mergeSharedSettings,type Settings} from '../shared/domain/settings';
export {stampSettings} from '../shared/domain/settings';
export type {Settings} from '../shared/domain/settings';
import {contentCopy} from './config/content-copy';
import {fetchEsvText} from './content';
import {canonical,sortItems} from '../shared/domain/ordering';
export {canonical,sortItems} from '../shared/domain/ordering';
import {isEsv,stripEsvText,assertEsvLimit,ESV_OFFLINE_MESSAGE} from '../shared/esv';
export {assertEsvLimit,ESV_OFFLINE_MESSAGE} from '../shared/esv';
export type Item={origin?:'mcp'|'group',id:string,title:string,text:string,collection:string,translation?:string,reference?:string,esvVerseKeys?:string[],step:number,learned:boolean,due:string,updatedAt:number,deleted?:boolean,card?:any,createdAt?:string,learnedAt?:string,order?:number,number?:number,part?:number,sortKey?:(string|number)[]};
export type ReviewEvent={id:string,itemId:string,at:string,slips:number,hidden:number,grade:string};
export type LocalState={items:Item[],events:ReviewEvent[],settings:Settings,queue:string[],account?:Account|null};
export type Account={id:string,displayName?:string,[key:string]:unknown};
export const today=()=>new Date().toLocaleDateString('en-CA');
export const defaults:Settings=settingsDefaults(Intl.DateTimeFormat().resolvedOptions().timeZone);
let db:IDBDatabase;
let settingsSnapshot:Settings|undefined;
export async function openStore():Promise<LocalState>{
 db=await new Promise((resolve,reject)=>{const r=indexedDB.open('byheart',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 return await new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').get('current');r.onsuccess=()=>{const state=r.result||emptyState();state.settings=loadSettings(state.settings,defaults.timeZone);state.items=mergeItems(state.items,[]).map(item=>{const migrated={...item,createdAt:item.createdAt||new Date(item.updatedAt||0).toISOString()};return {...migrated,sortKey:canonical(migrated)}}); settingsSnapshot=JSON.parse(JSON.stringify(state.settings));resolve(state)};r.onerror=()=>reject(r.error)});
}
export async function persist(state:LocalState){assertEsvLimit(state.items);state.settings=stampSettings(state.settings,settingsSnapshot);settingsSnapshot=JSON.parse(JSON.stringify(state.settings));return new Promise<Settings>((resolve,reject)=>{const tx=db.transaction('state','readwrite');const snapshot=JSON.parse(JSON.stringify(state));snapshot.items=snapshot.items.map((item:Item)=>({...((isEsv(item)&&item.deleted)?stripEsvText(item):item),sortKey:canonical(item)}));tx.objectStore('state').put(snapshot,'current');tx.oncomplete=()=>resolve(state.settings);tx.onerror=()=>reject(tx.error)})}
export async function api(path:string,body?:unknown,method?:string){const r=await fetch('/api'+path,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(path==='/sync'?syncPayload(body):body):undefined});const result=await r.json();if(!r.ok)throw new Error((result.error||contentCopy.retry)+(result.requestId?' (Request '+result.requestId+')':''));return result}
/** Unique by id, including tombstones; old corrupt duplicate arrays are repaired on load. */
export function mergeItems(local:Item[],remote:Item[]):Item[]{const map=new Map<string,Item>();for(const item of [...local,...remote]){const existing=map.get(item.id);if(!existing||Number(item.updatedAt)>Number(existing.updatedAt)||(Number(item.updatedAt)===Number(existing.updatedAt)&&JSON.stringify(stripEsvText(item))>JSON.stringify(stripEsvText(existing))))map.set(item.id,item)}const merged=[...map.values()].map(item=>{if(!isEsv(item))return item;const cached=local.find(i=>i.id===item.id&&isEsv(i)&&i.text&&i.reference===item.reference&&JSON.stringify(i.esvVerseKeys)===JSON.stringify(item.esvVerseKeys));return {...stripEsvText(item),text:item.deleted?'':cached?.text||''}});return sortItems(merged)}
export function findLiveItem(items:Item[],id:string){return items.find(item=>item.id===id&&!item.deleted)}
/** Re-add replaces the tombstone, resets progress, and has a strictly newer revision. */
export function addItems(existing:Item[],incoming:Partial<Item>[],collection?:string,now=Date.now()):Item[]{let result=mergeItems(existing,[]);for(const source of incoming){if(!source.id||findLiveItem(result,source.id))continue;const previous=result.find(i=>i.id===source.id);const item={...source,collection:collection||source.collection||'personal',step:1,learned:false,deleted:false,card:undefined,learnedAt:undefined,due:new Date(now).toISOString(),createdAt:new Date(now).toISOString(),updatedAt:Math.max(now,(previous?.updatedAt||0)+1)} as Item;item.sortKey=canonical(item);result=mergeItems(result,[item]);if(isEsv(item))result=result.map(i=>i.id===item.id?item:i)}assertEsvLimit(result);return result}
export function emptyState():LocalState{return {items:[],events:[],settings:structuredClone(defaults),queue:[],account:null}}
/** Call only after the sign-out/discard confirmation; removes account practice and identity. */
export async function clearStore():Promise<LocalState>{const state=emptyState();settingsSnapshot=undefined;await persist(state);return state}
export async function cacheAccount(state:LocalState,account:Account|null){state.account=account;await persist(state)}
export function mergeSettings(local:Settings,remote:Partial<Settings>):Settings{return mergeSharedSettings(local,remote) as Settings}
/** Retry even when config failed on startup; cleanup on component unmount. */
export function installReconnectSync(sync:()=>void|Promise<void>){const retry=()=>{void sync()};const visible=()=>{if(document.visibilityState==='visible')retry()};window.addEventListener('online',retry);window.addEventListener('focus',retry);document.addEventListener('visibilitychange',visible);return()=>{window.removeEventListener('online',retry);window.removeEventListener('focus',retry);document.removeEventListener('visibilitychange',visible)}}

/** Keep trying while pending even if the browser never emits an online event. */
export function installQueueRetry(pending:()=>boolean,sync:()=>Promise<void>,delays=[5000,15000,60000,300000]){
 let timer:ReturnType<typeof setTimeout>|undefined,step=0,stopped=false,running=false;
 const schedule=()=>{if(stopped||running)return;if(!pending()){if(timer)clearTimeout(timer);timer=undefined;step=0;return}if(!timer)timer=setTimeout(async()=>{timer=undefined;running=true;try{await sync()}catch{}finally{running=false;step=Math.min(step+1,delays.length-1);schedule()}},delays[step])};
 return {update:schedule,stop:()=>{stopped=true;if(timer)clearTimeout(timer)}};
}

/** Defense in depth at the only API write boundary; callers cannot accidentally sync ESV quotations. */
export function syncPayload(body:unknown):unknown {
 if(!body||typeof body!=='object')return body;
 const value=body as {items?:Item[],settings?:Settings};
 return {...value,...(value.settings?{settings:migrateSettings(value.settings)}:{}),...(Array.isArray(value.items)?{items:value.items.map(stripEsvText)}:{})};
}
/** Call before opening practice/preview, then persist the state. No revision/queue bump: cache is device-only. */
export async function ensureItemText(item:Item):Promise<Item> {
 if(!isEsv(item)||item.text)return item;
 if(typeof navigator!=='undefined'&&navigator.onLine === false)throw Error(ESV_OFFLINE_MESSAGE);
 if(!item.reference)throw Error(ESV_OFFLINE_MESSAGE);
 item.text=await fetchEsvText(item.reference);
 return item;
}
