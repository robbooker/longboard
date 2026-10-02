import {expect,it} from 'vitest';
import {boundChatActivity,CHAT_ACTIVITY_MAX_BYTES,emptyChatActivity,type ChatActivity} from '@/lib/chatActivity';
it('bounds actual UTF-8 JSON bytes while retaining complete snapshot counts and cursors',()=>{
 const unicode='😅界\\"\n'.repeat(1000);
 const data:ChatActivity={...emptyChatActivity,mentionCount:987,dmCount:654,reactionCount:321,mentionThrough:12345,dmThrough:67890,reactionThrough:99999,
  pinnedDmUnread:Object.fromEntries(Array.from({length:50},(_,i)=>[`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,Number.MAX_SAFE_INTEGER])),
  mentions:Array.from({length:50},(_,i)=>({id:String(i),seq:100-i,messageId:String(i),room:'main',author:unicode,preview:unicode,parentPreview:unicode,createdAt:new Date(200000-i*1000).toISOString()})),
  dms:Array.from({length:100},(_,i)=>({id:String(i),name:unicode,unread:5,throughSeq:100-i,pending:false,preview:unicode,createdAt:new Date(100000-i*1000).toISOString()})),
  reactions:Array.from({length:50},(_,i)=>({id:String(i),seq:100-i,messageId:String(i),kind:'dm',conversationId:String(i),author:unicode,emoji:'rob',preview:unicode,createdAt:new Date(300000-i*1000).toISOString()})),
 };
 const bounded=boundChatActivity(data),serialized=JSON.stringify(bounded);
 expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(CHAT_ACTIVITY_MAX_BYTES);
 expect(Buffer.byteLength(serialized,'utf8')).toBeLessThanOrEqual(32768);
 expect(bounded).toMatchObject({mentionCount:987,dmCount:654,reactionCount:321,mentionThrough:12345,dmThrough:67890,reactionThrough:99999});
 expect(bounded.pinnedDmUnread).toEqual(data.pinnedDmUnread);
 expect(bounded.reactions![0].id).toBe('0');expect(bounded.reactions!.length+bounded.mentions.length+bounded.dms.length).toBeLessThan(200);
 expect(data.dms).toHaveLength(100);expect(data.reactions).toHaveLength(50);
 for(const row of bounded.reactions!)expect(Array.from(row.preview).length).toBeLessThanOrEqual(240);
 expect(serialized).not.toContain('\\ud83d"');
});
it('keeps normal previews intact and accepts rolling-deploy payloads without reactions',()=>{
 const {reactions:_,reactionCount:__,reactionThrough:___,...old}=emptyChatActivity;void _;void __;void ___;
 const data={...old,dms:[{id:'dm',name:'Alice',unread:1,throughSeq:5,pending:false}],mentions:[{id:'mention',seq:2,messageId:'message',room:'main' as const,author:'Bob',preview:'A useful complete preview',parentPreview:'Earlier context',createdAt:'2026-10-01'}]};
 expect(boundChatActivity(data)).toMatchObject({...data,reactions:[]});
 expect(boundChatActivity(data)).not.toHaveProperty('pinnedDmUnread');
});
it('preserves explicit zero but bounds the pin map and rejects invalid counts and identifiers',()=>{
 const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const pinnedDmUnread={invalid:2,[id(100)]:-1,[id(101)]:Infinity,[id(102)]:1.5,...Object.fromEntries(Array.from({length:55},(_,i)=>[id(i),i]))};
 const result=boundChatActivity({...emptyChatActivity,pinnedDmUnread});
 expect(Object.keys(result.pinnedDmUnread!)).toHaveLength(50);
 expect(result.pinnedDmUnread![id(0)]).toBe(0);
 expect(result.pinnedDmUnread).not.toHaveProperty(id(50));
 expect(result.pinnedDmUnread).not.toHaveProperty('invalid');
});
it('preserves read history metadata without deriving unread totals or observed boundaries from it',()=>{
 const data:ChatActivity={...emptyChatActivity,
  mentions:[{id:'read',seq:900,messageId:'target',room:'main',author:'Bob',preview:'Retained',createdAt:'2026-10-02',read:true},{id:'legacy',seq:2,messageId:'other',room:'main',author:'Bob',preview:'Unread',createdAt:'2026-10-01'}],
  dms:[{id:'dm',name:'Alice',unread:0,throughSeq:950,pending:false,preview:'Retained incoming'}],
  reactions:[{id:'read-reaction',seq:990,messageId:'target',kind:'room',room:'main',author:'Alice',emoji:'heart',preview:'Retained',createdAt:'2026-10-02',read:true}],
  mentionCount:1,mentionThrough:2,roomCounts:{main:1},roomThrough:{main:2},pinnedDmUnread:{'00000000-0000-4000-8000-000000000001':0},
 };
 const bounded=boundChatActivity(data);
 expect(bounded.mentions[0].read).toBe(true);expect(bounded.mentions[1].read).toBeUndefined();expect(bounded.reactions![0].read).toBe(true);expect(bounded.dms[0].unread).toBe(0);
 expect(bounded).toMatchObject({mentionCount:1,mentionThrough:2,dmCount:0,dmThrough:0,reactionCount:0,reactionThrough:0,roomCounts:{main:1},roomThrough:{main:2}});
});
