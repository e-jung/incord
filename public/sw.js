const CACHE='byheart-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/manifest.webmanifest','/icon-192.png'])));self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(url.origin!==location.origin||url.pathname.startsWith('/api/')||event.request.method!=='GET')return;
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const clone=response.clone();caches.open(CACHE).then(c=>c.put(event.request,clone))}return response}).catch(()=>event.request.mode==='navigate'&&!/^\/(content|assets)(?:\/|$)/.test(url.pathname)?caches.match('/'):Response.error())));
});
self.addEventListener('push',event=>{let data={title:'By Heart',body:'You have 1 item to practice today.',tag:'by-heart-daily',url:'/'};try{Object.assign(data,event.data.json())}catch{}event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icon-192.png',tag:data.tag,renotify:data.tag==='by-heart-test',data:{url:'/'}}))});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{const app=windows.find(client=>new URL(client.url).origin===self.location.origin);return app?app.focus():self.clients.openWindow('/')}))});
// A rotated subscription must reach the same account, never a third party.
self.addEventListener('pushsubscriptionchange',event=>event.waitUntil((async()=>{
 try{const options=event.oldSubscription?.options;if(!options)return;const subscription=event.newSubscription||await self.registration.pushManager.subscribe(options);await fetch('/api/push/subscribe',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({subscription:subscription.toJSON()})})}catch{/* Account-load reconciliation retries on next open. */}
})()));
