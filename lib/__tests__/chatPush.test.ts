import {describe,it,expect,vi} from 'vitest';
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:vi.fn()}));
import {validPushEndpoint,parsePushSubscription} from '../chatPush';
describe('push capability validation',()=>{
 it('permits only fixed browser providers over default HTTPS',()=>{
  for(const url of ['https://fcm.googleapis.com/fcm/send/abc','https://updates.push.services.mozilla.com/wpush/v2/abc','https://web.push.apple.com/abc'])expect(validPushEndpoint(url)).toBe(true);
  for(const url of ['http://fcm.googleapis.com/fcm/send/abc','https://localhost/a','https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/fcm/send/x','https://web.push.apple.com:444/a','https://user@web.push.apple.com/a','https://fcm.googleapis.com/other','https://web.push.apple.com/a#x'])expect(validPushEndpoint(url)).toBe(false);
 });
 it('accepts exact uncompressed P256 public key and auth token shape only',()=>{const s={endpoint:'https://web.push.apple.com/abc',keys:{p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64,1)]).toString('base64url'),auth:Buffer.alloc(16,1).toString('base64url')}};expect(parsePushSubscription(s)).toEqual(s);expect(parsePushSubscription({...s,keys:{...s.keys,auth:'abc'}})).toBeNull();expect(parsePushSubscription({...s,keys:{...s.keys,p256dh:Buffer.alloc(65,1).toString('base64url')}})).toBeNull();});
});
