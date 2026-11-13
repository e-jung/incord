import {contentCopy} from './config/content-copy';
export type Item={id:string,title:string,text:string,collection:string,translation?:string,step:number,learned:boolean,due:string,updatedAt:number,deleted?:boolean,card?:any,createdAt?:string,learnedAt?:string};
export type Settings={name:string,theme:string,goal:number,reminderTime:string,timeZone:string,pushEnabled:boolean,days:string[],lastActive:string,returnStart?:string,updatedAt:number};
export type ReviewEvent={id:string,itemId:string,at:string,slips:number,hidden:number,grade:string};
export type LocalState={items:Item[],events:ReviewEvent[],settings:Settings,queue:string[]};
export const today=()=>new Date().toLocaleDateString('en-CA');
export const defaults:Settings={name:'',theme:'system',goal:4,reminderTime:'19:00',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,pushEnabled:false,days:[],lastActive:'',updatedAt:0};
let db:IDBDatabase;
export async function openStore():Promise<LocalState>{
 db=await new Promise((resolve,reject)=>{const r=indexedDB.open('byheart',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
 return await new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').get('current');r.onsuccess=()=>resolve(r.result||{items:[],events:[],settings:{...defaults},queue:[]});r.onerror=()=>reject(r.error)});
}
export async function persist(state:LocalState){return new Promise<void>((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(JSON.parse(JSON.stringify(state)),'current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)})}
export async function api(path:string,body?:unknown,method?:string){const r=await fetch('/api'+path,{method:method||(body?'POST':'GET'),headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const result=await r.json();if(!r.ok)throw new Error(result.error||contentCopy.retry);return result}
export function mergeItems(local:Item[],remote:Item[]):Item[]{const map=new Map(local.map(x=>[x.id,x]));for(const item of remote){const existing=map.get(item.id);if(!existing||Number(item.updatedAt)>Number(existing.updatedAt)||(Number(item.updatedAt)===Number(existing.updatedAt)&&JSON.stringify(item)>JSON.stringify(existing)))map.set(item.id,item)}return [...map.values()]}
