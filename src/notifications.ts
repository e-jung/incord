import {api} from './store';
export type Delivery={time?:number,host:string,status:number,reason:string};
export type DevicePush='on'|'off'|'missing'|'denied'|'unsupported'|'unavailable';
export async function subscriptionHash(endpoint:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(endpoint)))].map(b=>b.toString(16).padStart(2,'0')).join('')}
export async function pushHealth(signedIn:boolean):Promise<{state:DevicePush,results:Delivery[]}>{
 if(!('Notification' in window)||!('PushManager' in window)||!('serviceWorker' in navigator))return {state:'unsupported',results:[]};
 const permission=Notification.permission;
 // getRegistration does not hang forever when SW registration failed.
 const registration=await navigator.serviceWorker.getRegistration();
 const subscription=await registration?.pushManager.getSubscription();
 if(!signedIn)return {state:permission==='denied'?'denied':permission==='granted'?'missing':'off',results:[]};
 const hash=subscription?await subscriptionHash(subscription.endpoint):'';
 let server=await api('/push/status'+(hash?'?endpointHash='+hash:''));
 // Reconcile rotated subscriptions and SW upgrades with the current account.
 if(subscription&&permission==='granted'&&!server.subscribed){await api('/push/subscribe',{subscription:subscription.toJSON()});server=await api('/push/status?endpointHash='+hash)}
 return {state:permission==='denied'?'denied':permission==='granted'?(subscription&&server.subscribed?'on':'missing'):'off',results:server.results||[]};
}
