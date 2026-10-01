import {expect,it} from 'vitest';
import {boundChatActivity,CHAT_ACTIVITY_MAX_BYTES,emptyChatActivity,type ChatActivity} from '@/lib/chatActivity';
it('bounds actual UTF-8 JSON bytes while retaining complete snapshot counts and cursors',()=>{
 const unicode='😅界\\"\n'.repeat(1000);
 const data:ChatActivity={...emptyChatActivity,mentionCount:987,dmCount:654,reactionCount:321,mentionThrough:12345,dmThrough:67890,reactionThrough:99999,
  mentions:Array.from({length:50},(_,i)=>({id:String(i),seq:100-i,messageId:String(i),room:'main',author:unicode,preview:unicode,parentPreview:unicode,createdAt:new Date(200000-i*1000).toISOString()})),
  dms:Array.from({length:100},(_,i)=>({id:String(i),name:unicode,unread:5,throughSeq:100-i,pending:false,preview:unicode,createdAt:new Date(100000-i*1000).toISOString()})),
  reactions:Array.from({length:50},(_,i)=>({id:String(i),seq:100-i,messageId:String(i),kind:'dm',conversationId:String(i),author:unicode,emoji:'rob',preview:unicode,createdAt:new Date(300000-i*1000).toISOString()})),
 };
 const bounded=boundChatActivity(data),serialized=JSON.stringify(bounded);
 expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(CHAT_ACTIVITY_MAX_BYTES);
 expect(Buffer.byteLength(serialized,'utf8')).toBeLessThanOrEqual(32768);
 expect(bounded).toMatchObject({mentionCount:987,dmCount:654,reactionCount:321,mentionThrough:12345,dmThrough:67890,reactionThrough:99999});
 expect(bounded.reactions![0].id).toBe('0');expect(bounded.reactions!.length+bounded.mentions.length+bounded.dms.length).toBeLessThan(200);
 expect(data.dms).toHaveLength(100);expect(data.reactions).toHaveLength(50);
 for(const row of bounded.reactions!)expect(Array.from(row.preview).length).toBeLessThanOrEqual(240);
 expect(serialized).not.toContain('\\ud83d"');
});
it('keeps normal previews intact and accepts rolling-deploy payloads without reactions',()=>{
 const {reactions:_,reactionCount:__,reactionThrough:___,...old}=emptyChatActivity;void _;void __;void ___;
 const data={...old,dms:[{id:'dm',name:'Alice',unread:1,throughSeq:5,pending:false}],mentions:[{id:'mention',seq:2,messageId:'message',room:'main' as const,author:'Bob',preview:'A useful complete preview',parentPreview:'Earlier context',createdAt:'2026-10-01'}]};
 expect(boundChatActivity(data)).toMatchObject({...data,reactions:[]});
});
