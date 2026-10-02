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
function notificationText(value,limit,fallback){
 if(typeof value!=='string')return fallback;
 const text=value.slice(0,2000).replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,'').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,' ').replace(/[*_`~]/g,'').replace(/[\ud800-\udfff]/gu,'').replace(/\s+/g,' ').trim();
 const characters=Array.from(text);
 return characters.length>limit?characters.slice(0,limit-1).join('')+'…':text||fallback;
}
self.addEventListener('push',event=>{
 let payload={};try{payload=event.data?.json()||{};}catch{}
 event.waitUntil(self.registration.showNotification(notificationText(payload.title,64,'Rob Booker Chat'),{
  body:notificationText(payload.body,40,'You have new chat activity.'),
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
