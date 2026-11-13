/** Deliberately never serialize exception messages: they may include private text. */
export const appVersion=import.meta.env.VITE_APP_VERSION||'development';
export function errorReport(error:unknown,route:string,ua:string){
 const value=error instanceof Error?error:null;
 const name=value&&['Error','TypeError','ReferenceError','SyntaxError','RangeError','URIError','EvalError'].includes(value.name)?value.name:'Error';
 const frames=(value?.stack||'').split('\n').slice(1,5).map(line=>line.match(/(?:\/assets\/)[a-zA-Z0-9_.-]+\.js:\d+:\d+/)?.[0]).filter(Boolean);
 return {message:`Unhandled ${name}`,stack:frames.join('\n'),route:route==='/gallery'?'/gallery':'/',version:appVersion,ua:/Firefox/i.test(ua)?'Firefox':/Edg\//.test(ua)?'Edge':/Chrome|Chromium/.test(ua)?'Chromium':/Safari/.test(ua)?'Safari':'Other'};
}
export function installErrorReporting(){
 let remaining=5;
 const send=(error:unknown)=>{if(remaining--<=0)return;void fetch('/api/log',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(errorReport(error,location.pathname,navigator.userAgent)),keepalive:true}).catch(()=>{})};
 window.addEventListener('error',event=>send(event.error));
 window.addEventListener('unhandledrejection',event=>send(event.reason));
}
