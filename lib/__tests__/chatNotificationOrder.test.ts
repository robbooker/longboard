import {expect,it} from 'vitest';
import {emptyChatActivity,type ChatActivity} from '@/lib/chatActivity';
import {orderedChatNotifications} from '@/lib/chatNotificationOrder';
const mention=(id:string,createdAt:string,read=false):ChatActivity['mentions'][number]=>({id,createdAt,read,seq:2,messageId:id,room:'main',author:'Alice',preview:id});
const dm=(id:string,createdAt?:string,unread=1):ChatActivity['dms'][number]=>({id,createdAt,unread,throughSeq:3,pending:false,name:'Bob'});
const reaction=(id:string,createdAt:string):NonNullable<ChatActivity['reactions']>[number]=>({id,createdAt,seq:4,kind:'room',room:'social',messageId:id,author:'Carol',emoji:'heart',preview:id});
it('interleaves all types by actual time, independent of read status and input order',()=>{
 const data={...emptyChatActivity,mentions:[mention('old','2026-10-02T12:00:00Z'),mention('new-read','2026-10-02T12:05:00Z',true)],dms:[dm('middle','2026-10-02T07:04:00-05:00',0)],reactions:[reaction('between','2026-10-02T12:03:00Z')]};
 expect(orderedChatNotifications(data).map(n=>n.key)).toEqual(['mention:new-read','dm:middle','reaction:between','mention:old']);
});
it('uses category-prefixed stable IDs for equal dates and ID collisions across categories',()=>{
 const date='2026-10-02T12:00:00Z';const data={...emptyChatActivity,mentions:[mention('z',date),mention('same',date)],dms:[dm('same',date)],reactions:[reaction('same',date)]};
 const expected=['dm:same','mention:same','mention:z','reaction:same'];
 expect(orderedChatNotifications(data).map(n=>n.key)).toEqual(expected);data.mentions.reverse();expect(orderedChatNotifications(data).map(n=>n.key)).toEqual(expected);
});
it('puts missing or invalid legacy dates last, retaining deterministic order and valid epoch dates',()=>{
 const data={...emptyChatActivity,mentions:[mention('invalid','not-a-date'),mention('epoch','1970-01-01T00:00:00Z')],dms:[dm('missing')],reactions:[reaction('empty','')]};
 expect(orderedChatNotifications(data).map(n=>n.key)).toEqual(['mention:epoch','dm:missing','mention:invalid','reaction:empty']);
});
it('does not mutate source samples, grouped DM rows, full counts or observed read boundaries',()=>{
 const data={...emptyChatActivity,mentionCount:87,dmCount:65,reactionCount:43,mentionThrough:20,dmThrough:30,reactionThrough:40,pinnedDmUnread:{saved:9},mentions:[mention('old','2020-01-01'),{...mention('read','2030-01-01',true),seq:900}],dms:[dm('conversation','2024-01-01',4)]};
 const before=structuredClone(data);Object.freeze(data.mentions);Object.freeze(data.dms);Object.freeze(data);
 const items=orderedChatNotifications(data);expect(items).toHaveLength(3);expect(items.find(n=>n.kind==='dm')?.value).toBe(data.dms[0]);expect(data).toEqual(before);
 expect(orderedChatNotifications({...emptyChatActivity,reactions:undefined})).toEqual([]);
});
