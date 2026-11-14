import {CODE_WORDS,normalizeCode} from '../shared/sign-in-code';
/** A saved copy belongs only to this browser, never to sync/export payloads. */
export type DeviceSignInCode={uid:string;code:string;revision:string;pending:boolean;newAccount?:boolean};
const codeKey='bh_signin_code',reminderKey='bh_code_backup_reminder';
export function readDeviceSignInCode():DeviceSignInCode|null{try{const value=JSON.parse(localStorage.getItem(codeKey)||'null');return value&&typeof value.uid==='string'&&typeof value.code==='string'&&/^[a-z0-9-]{16,90}$/.test(value.code)&&typeof value.revision==='string'&&typeof value.pending==='boolean'?value:null}catch{return null}}
export function rememberDeviceSignInCode(value:DeviceSignInCode){try{localStorage.setItem(codeKey,JSON.stringify(value));return true}catch{return false}}
export function forgetDeviceSignInCode(){try{localStorage.removeItem(codeKey)}catch{}}
export function codeReminderUntil(uid:string){try{const value=JSON.parse(localStorage.getItem(reminderKey)||'null');return value?.uid===uid&&Number.isFinite(value.until)?value.until:0}catch{return 0}}
export function dismissCodeReminder(uid:string){const until=Date.now()+30*86400000;try{localStorage.setItem(reminderKey,JSON.stringify({uid,until}))}catch{}return until}

/** Restore readable separators even when a code was entered without hyphens. */
export function displaySignInCode(value:string){const normalized=normalizeCode(value),text=normalized.slice(0,-4);function parts(at:number,count:number):string[]|null{if(count===0)return at===text.length?[]:null;for(const word of CODE_WORDS)if(text.startsWith(word,at)){const rest=parts(at+word.length,count-1);if(rest)return [word,...rest]}return null}const found=parts(0,3);return found?found.join('-')+'-'+normalized.slice(-4):value.trim().toLowerCase()}
