/** Test-only transport adapter: production Worker and DOs remain unchanged. */
import worker from '../worker';
export {UserDO,RegistryDO,GroupDO,StatsDO,OAuthStorageDO} from '../worker';
export default {
 async fetch(request:Request,env:Parameters<typeof worker.fetch>[1],ctx:ExecutionContext){
  const url=new URL(request.url);
  if(url.pathname.startsWith('/__test/accounts/')&&env.EMAIL_TEST_SINK==='1'&&['localhost','127.0.0.1'].includes(url.hostname)){
   const svc=(env as typeof env & {ACCOUNTS_SVC:Fetcher}).ACCOUNTS_SVC;return svc.fetch(new Request('https://fake/'+url.pathname.slice('/__test/accounts/'.length)+url.search,{redirect:'manual'}));
  }
  if(url.pathname==='/api/test/last-code'&&request.method==='GET'&&env.EMAIL_TEST_SINK==='1'&&['localhost','127.0.0.1'].includes(url.hostname)){
   // Only test infrastructure can expose the fake mailbox. Never add this adapter to production.
   const svc=(env as typeof env & {ACCOUNTS_SVC:Fetcher}).ACCOUNTS_SVC;
   return svc.fetch(new Request('https://fake/__test/last-code'+url.search,{redirect:'manual'}));
  }
  return worker.fetch(request,env,ctx);
 }
};
