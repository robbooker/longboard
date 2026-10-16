// Loaded into the Next dev server for chat-event-stream-browser.mjs: the server's Ably REST
// publishes (any *.ably.* host) go to the test's local hub on 127.0.0.1:54597 instead, over
// plain HTTP. Nothing else is touched and no real Ably is ever reached.
import http from 'node:http';
import https from 'node:https';
const HUB={host:'127.0.0.1',port:54597};
const original=https.request;
https.request=function(...args){
 let url=null,options={},callback;
 for(const a of args){if(typeof a==='string'||a instanceof URL)url=new URL(String(a));else if(typeof a==='function')callback=a;else if(a&&typeof a==='object')options=a;}
 const host=url?.hostname||options.hostname||String(options.host||'').split(':')[0];
 if(!/(^|\.)ably\.(io|net|com)$/.test(host))return original.apply(this,args);
 const {agent:_a,createConnection:_c,servername:_s,...rest}=options;
 const redirected={...rest,protocol:'http:',hostname:HUB.host,host:HUB.host,port:HUB.port,path:url?url.pathname+url.search:options.path};
 return callback?http.request(redirected,callback):http.request(redirected);
};
