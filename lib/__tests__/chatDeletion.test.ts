import {expect,it} from 'vitest';
import {mergeRoomMessage,type PublicChatMessage} from '../publicChat';
import {reconcileRoomMessages} from '../chatMessageIdentity';
import {mergeConfirmedMessages} from '../chatPendingMessages';
const original:PublicChatMessage={id:'root',guest_id:'guest',body:'deleted original',author_label:'Owner',created_at:'2026-10-01',revision:0};
const removed={...original,body:'Message deleted',attachment_ids:[],deleted_at:'2026-10-01',removed:true,revision:1};
it('a delayed send ACK cannot restore a removed room leaf before or after history refresh',()=>{
 const deleted=mergeRoomMessage([original],removed);
 expect(mergeRoomMessage(deleted,original)).toEqual([removed]);
 expect(mergeRoomMessage(reconcileRoomMessages(deleted,[]),original)).toEqual([removed]);
});
it('a stale history snapshot cannot restore erased room text or attachments',()=>{
 expect(reconcileRoomMessages([removed],[{...original,attachment_ids:['secret']}])).toEqual([removed]);
});
it('an exact newer edit deliberately replaces a retained tombstone, but an old deletion cannot erase it',()=>{
 const retained={...removed,removed:false};const replacement={...retained,body:'Deliberate replacement',deleted_at:null,revision:2};
 expect(mergeRoomMessage([retained],replacement)).toEqual([replacement]);
 expect(mergeRoomMessage([replacement],retained)).toEqual([replacement]);
});
it('DM confirmation reconciliation retains deletion and sequence against delayed ACKs',()=>{
 const dm={id:'dm',seq:42,body:'Original',revision:0};const gone={...dm,body:'Message deleted',deleted_at:'now',revision:1};
 expect(mergeConfirmedMessages([gone],[dm])).toEqual([gone]);
});
