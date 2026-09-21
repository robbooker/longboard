/* Chat-only push worker. Deliberately no fetch handler or private-content cache. */
self.addEventListener('install',()=>{});
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('message',event=>{
 if(event.data?.type==='CHAT_ACTIVATE_UPDATE')self.skipWaiting();
});
function chatUrl(value){
 try{const url=new URL(value,self.location.origin);if(url.origin===self.location.origin&&url.pathname==='/chat')return url.href;}catch{}
 return new URL('/chat',self.location.origin).href;
}
self.addEventListener('push',event=>{
 let payload={};try{payload=event.data?.json()||{};}catch{}
 event.waitUntil(self.registration.showNotification('Rob Booker Chat',{
  body:typeof payload.body==='string'?payload.body.slice(0,160):'You have new chat activity.',
  icon:'/chat-rb-icon-v1-192.png',badge:'/chat-badge.png',
  tag:typeof payload.tag==='string'?payload.tag.slice(0,100):'chat-activity',
  data:{url:chatUrl(payload.url)},
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const url=chatUrl(event.notification.data?.url);
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const exact=windows.find(client=>client.url===url);
  if(exact){await exact.focus();return;}
  // Opening a separate conversation avoids replacing an unsent draft in an existing window.
  await self.clients.openWindow(url);
 })());
});
