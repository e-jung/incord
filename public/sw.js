const CACHE='byheart-v1';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/','/manifest.webmanifest','/icon-192.png'])));self.skipWaiting()});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);if(url.origin!==location.origin||url.pathname.startsWith('/api/')||event.request.method!=='GET')return;
 event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{if(response.ok){const clone=response.clone();caches.open(CACHE).then(c=>c.put(event.request,clone))}return response}).catch(()=>event.request.mode==='navigate'&&!/^\/(content|assets)(?:\/|$)/.test(url.pathname)?caches.match('/'):Response.error())));
});
self.addEventListener('push',event=>{let data={title:'By Heart',body:'A little practice. A lasting word.'};try{Object.assign(data,event.data.json())}catch{}event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:'/icon-192.png',tag:'byheart-daily',data:{url:'/'}}))});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window'}).then(windows=>windows.length?windows[0].focus():self.clients.openWindow('/')))});
