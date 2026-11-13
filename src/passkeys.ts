import {copy} from './config/copy';
/** Browser/library errors are never user-facing DOMException text. API errors remain actionable. */
export function passkeyError(error:unknown):Error{
 const name=(error as {name?:string})?.name||'',code=(error as {code?:string})?.code||'';
 if(name==='InvalidStateError'||code==='ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'){const mapped=Error(copy.passkeyAlready);mapped.name='PasskeyAlreadyRegistered';return mapped}
 if(['NotAllowedError','AbortError'].includes(name)||/ABORT|CANCEL/.test(code))return Error('Cancelled');
 if(/not supported|resident credentials|secure context/i.test((error as {message?:string})?.message||'')||['NotSupportedError','SecurityError','TypeError'].includes(name)||/SUPPORT|RESIDENT|INVALID_RP/.test(code))return Error(copy.passkeyUnsupported);
 return Error(copy.passkeyFailed);
}
export async function browserPasskey<T>(fn:()=>Promise<T>):Promise<T>{try{return await fn()}catch(error){throw passkeyError(error)}}
