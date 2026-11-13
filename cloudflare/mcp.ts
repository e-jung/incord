import { OAuthResourceServer, insufficientScope } from '@cloudflare/workers-oauth-provider';
import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import type { Env } from './worker';
import { submitFeedback } from './feedback';
import { oauthCall, type McpIdentity } from './oauth-storage';
import { runMcpTool, MCP_TOOL_SCHEMAS } from './mcp-tools';

async function userCall(env:Env,uid:string,path:string,data:unknown={}) {const r=await env.USERS.get(env.USERS.idFromName(uid)).fetch('https://internal'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});if(!r.ok)throw Error('Account unavailable');return r.json<any>();}
async function hash(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
async function limit(env:Env,key:string,n:number,window=60000) {const r=await env.REGISTRY.get(env.REGISTRY.idFromName('registry')).fetch('https://internal/limit',{method:'POST',body:JSON.stringify({key,limit:n,window})});return r.ok;}
const toolNames=['lookup_passage','add_passages','list_library','get_due_today','get_progress','list_collections','send_feedback'] as const;
export async function handleMcpRequest(request:Request,env:Env,ctx:ExecutionContext):Promise<Response|null> {
  const url=new URL(request.url),path=url.pathname,origin=env.APP_ORIGIN?new URL(env.APP_ORIGIN).origin:url.origin;
  const isResource=path==='/mcp'||path.startsWith('/.well-known/oauth-protected-resource');
  const isOAuth=path==='/oauth/token'||path==='/oauth/register'||path.startsWith('/.well-known/oauth-authorization-server');
  if(!isResource&&!isOAuth)return null;
  if(url.origin!==origin)return Response.json({error:'Wrong host'},{status:403});
  if(isOAuth){
    if(!['GET','HEAD','OPTIONS'].includes(request.method)&&!await limit(env,'oauth:'+await hash(env.SESSION_SECRET+':'+(request.headers.get('CF-Connecting-IP')||'local')),60))return Response.json({error:'temporarily_unavailable'},{status:429,headers:{'Retry-After':'60'}});
    const text=await readMcpBody(request,65536);if(text===null)return Response.json({error:'invalid_request'},{status:413});
    return oauthCall(env,'/http',{origin,url:request.url,method:request.method,headers:[...request.headers],...(request.body?{body:text}:{})});
  }
  const resource=new OAuthResourceServer<Env,McpIdentity>({resourceMetadata:{resource:origin+'/mcp',authorization_servers:[origin],resource_name:'Incord'},requiredScopes:['library:read','library:write'],validateToken:()=>async(_resource,token)=>{
    const r=await oauthCall(env,'/validate',{origin,token});if(!r.ok)throw Error('Validation unavailable');const valid=await r.json<any>();if(!valid)return null;
    try{const me=await userCall(env,valid.props.uid,'/me');if(me.version!==valid.props.version)return null;valid.props.statsEnabled=valid.props.statsEnabled&&me.mcpCountsEnabled!==false;}catch{return null;}
    return valid;
  },handler:{fetch:async(req,bindings,authCtx)=>{
    const {props,auth}=authCtx;
    if(!await limit(bindings,'mcp:user:'+props.uid,60)||!await limit(bindings,'mcp:token:'+await hash(auth.token),30))return Response.json({error:'rate_limited'},{status:429,headers:{'Retry-After':'60'}});
    const text=await readMcpBody(req,1000000);if(text===null)return Response.json({error:'Request too large'},{status:413});
    let call:any;try{call=text?JSON.parse(text):null;}catch{return Response.json({error:'Invalid JSON'},{status:400});}
    if(Array.isArray(call))return Response.json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Batch requests are not supported.'}},{status:400});
    // Check at HTTP boundary as well as tool boundary so clients can step up scopes.
    if(call?.method==='tools/call'&&toolNames.includes(call.params?.name)&&call.params.name!=='send_feedback'){
      const needed=call.params.name==='add_passages'?'library:write':'library:read';
      if(!auth.scope.includes(needed))return insufficientScope(auth,[...new Set([...auth.scope,needed])]);
    }
    const handler=createMcpHandler(()=>{
      const server=new McpServer({name:'Incord',version:'1.0.0'});
      for(const name of toolNames){
        const scope=name==='send_feedback'?null:name==='add_passages'?'library:write':'library:read';
        server.registerTool(name,{...MCP_TOOL_SCHEMAS[name],annotations:{readOnlyHint:name!=='add_passages'&&name!=='send_feedback',destructiveHint:false,idempotentHint:name!=='send_feedback',openWorldHint:name==='send_feedback'}},async(args:any)=>{
          let ok=false;
          try{
            if(scope&&!auth.scope.includes(scope))return {isError:true,content:[{type:'text' as const,text:'Missing scope: '+scope}]};
            const result=await runMcpTool(name,args,{assets:bindings.ASSETS,feedback:input=>submitFeedback(req,bindings,input,{uid:props.uid,clientName:props.clientName},'mcp'),read:()=>userCall(bindings,props.uid,'/mcp/state',{events:name==='get_due_today'||name==='get_progress'}),add:async items=>{const result=await userCall(bindings,props.uid,'/mcp/add',{items,version:props.version});const schedule=await bindings.REGISTRY.get(bindings.REGISTRY.idFromName('registry')).fetch('https://internal/schedule/set',{method:'POST',body:JSON.stringify({uid:props.uid})});if(!schedule.ok)throw Error('Reminder scheduling unavailable');return result;}});ok=true;
            return {content:[{type:'text' as const,text:JSON.stringify(result)}]};
          }catch(error){const status=(error as {status?:number})?.status;const message=name==='send_feedback'&&status&&status>=400&&status<500&&error instanceof Error?error.message:'Unable to complete this tool call. Check the arguments and try again.';return {isError:true,content:[{type:'text' as const,text:message}]};}
          finally{
            console.log(JSON.stringify({evt:'mcp',tool:name,ok}));
            if(props.statsEnabled&&req.headers.get('DNT')!=='1'&&req.headers.get('Sec-GPC')!=='1')authCtx.waitUntil(bindings.STATS.get(bindings.STATS.idFromName('stats')).fetch('https://internal/aggregate',{method:'POST',body:JSON.stringify({event:'mcp_tool:'+name})}).then(()=>{}).catch(()=>{}));
          }
        });
      }
      return server;
    },{route:'/mcp',allowedHostnames:[url.hostname],allowedOriginHostnames:'*'});
    return handler(new Request(req.url,{method:req.method,headers:req.headers,...(req.body?{body:text}:{})}),bindings,authCtx);
  }}});
  return resource.fetch(request,env,ctx);
}
async function readMcpBody(request:Request,max:number):Promise<string|null>{if(!request.body)return '';const reader=request.body.getReader();const decoder=new TextDecoder();let bytes=0,text='';while(true){const part=await reader.read();if(part.done)return text+decoder.decode();bytes+=part.value.byteLength;if(bytes>max){await reader.cancel();return null;}text+=decoder.decode(part.value,{stream:true});}}
