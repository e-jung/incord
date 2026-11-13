import {esvReferenceKeys,assertEsvBookLimit} from '../shared/esv';
/** No storage or cache access: the text exists only for this request. */
export {assertEsvLimit, stripEsvText} from '../shared/esv';
export interface EsvEnv {ESV_API_KEY?:string}
export interface EsvAccess {
 /** Must validate the signed session, including account revocation/version. */
 signedIn:()=>Promise<boolean>;
 /** Persistent IP limiter owned by the router. Pass limit=30 and windowSeconds=3600. */
 anonymousAllowed:(limit:number,windowSeconds:number)=>Promise<boolean>;
}
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Content-Type':'text/plain; charset=utf-8'};
const problem=(status:number,error:string)=>new Response(JSON.stringify({error}),{status,headers:{...headers,'Content-Type':'application/json'}});
export async function handleEsv(request:Request,env:EsvEnv,access:EsvAccess):Promise<Response>{
 if(request.method!=='GET')return problem(405,'Use GET to load ESV text.');
 const q=new URL(request.url).searchParams.get('q')?.trim();
 // One contiguous, explicit Bible range only. Reject free-text search and arbitrary API queries.
 if(!q||q.length>160||! /^(?:[1-3]\s*)?[A-Za-z][A-Za-z\s]+\s\d{1,3}(?::\d{1,3})?(?:\s*[-–]\s*\d{1,3}(?::\d{1,3})?)?$/.test(q))return problem(400,'Enter a Bible passage reference.');
 try{assertEsvBookLimit(esvReferenceKeys(q),true);}catch(error){return problem(400,error instanceof Error?error.message:'Enter a Bible passage reference.');}
 if(!await access.signedIn()&&!await access.anonymousAllowed(30,3600))return problem(429,'ESV request limit reached. Try again in an hour.');
 if(!env.ESV_API_KEY)return problem(503,'ESV is unavailable right now.');
 const url=new URL('https://api.esv.org/v3/passage/text/');url.searchParams.set('q',q);
 for(const name of ['include-headings','include-footnotes','include-verse-numbers','include-first-verse-numbers','include-short-copyright','include-copyright','include-passage-references'])url.searchParams.set(name,'false');
 try{
  const response=await fetch(url,{headers:{Authorization:`Token ${env.ESV_API_KEY}`},redirect:'manual',cache:'no-store'});
  if(!response.ok)return problem(response.status===429?429:502,'ESV is unavailable right now. Please try again.');
  const result=await response.json() as {passages?:unknown};
  // A contiguous query must have exactly one passage. Do not join, trim, normalize or rewrite publisher text.
  if(!Array.isArray(result.passages)||result.passages.length!==1||typeof result.passages[0]!=='string'||!result.passages[0].trim())return problem(404,'No ESV passage found.');
  return new Response(result.passages[0],{headers});
 }catch{return problem(502,'ESV is unavailable right now. Please try again.');}
}
