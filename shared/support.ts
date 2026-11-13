/** Public, optional configuration. Refuse executable/credential-bearing URLs. */
export function supportUrl(value: unknown): string | null {
  if(typeof value!=='string'||!value.trim()||value.length>2048)return null;
  try {const url=new URL(value.trim());return url.protocol==='https:'&&!url.username&&!url.password?url.href:null}catch{return null}
}
