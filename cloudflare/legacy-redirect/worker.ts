// Deliberately no assets, secrets, Durable Objects, or application imports.
const legacyServiceWorker = `self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{await self.registration.unregister();for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})){const url=new URL(client.url);url.hostname='incord.jesklabs.com';url.protocol='https:';url.port='';await client.navigate(url.href)}})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.mode==='navigate'){url.hostname='incord.jesklabs.com';url.protocol='https:';url.port='';event.respondWith(Response.redirect(url.href,301))}});`;

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    let response: Response;
    if (url.pathname === '/sw.js') {
      response = new Response(request.method === 'HEAD' ? null : legacyServiceWorker, { headers: {
        'Content-Type': 'application/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/',
      } });
    } else if (url.pathname.startsWith('/api/')) {
      response = new Response(request.method === 'HEAD' ? null : JSON.stringify({ error: 'Incord has moved. Update this app at https://incord.jesklabs.com.' }), {
        status: 410, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    } else {
      url.hostname = 'incord.jesklabs.com'; url.protocol = 'https:'; url.port = '';
      response = new Response(null, { status: 301, headers: { Location: url.href } });
    }
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('Referrer-Policy', 'no-referrer');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    return response;
  },
};
