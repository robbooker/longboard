import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
const m=vi.hoisted(()=>({auth:vi.fn(),rpc:vi.fn(),origin:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:m.auth}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({rpc:m.rpc,from:m.from}),requestOriginAllowed:m.origin}));
import {POST} from '@/app/api/chat/message-reactions/route';
const id='00000000-0000-4000-8000-000000000001';
const req=(data={})=>new NextRequest('https://longboard.test/api/chat/message-reactions',{method:'POST',body:JSON.stringify({action:'set',kind:'room',room:'social',messageId:id,emoji:'heart',active:true,...data})});
beforeEach(()=>{vi.clearAllMocks();m.origin.mockReturnValue(true);m.auth.mockResolvedValue({ok:true,user:{id:'trusted'},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});m.rpc.mockResolvedValue({data:{[id]:[]},error:null});});
it.each(['room','dm'])('accepts fixed Rob reaction in %s',async kind=>{expect((await POST(req({kind,conversationId:id,emoji:'rob'}))).status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('set_chat_message_reaction',expect.objectContaining({p_emoji:'rob',p_actor:'trusted'}));});
it('derives actor from auth and requires explicit boolean state',async()=>{expect((await POST(req({actor:'forged'}))).status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('set_chat_message_reaction',expect.objectContaining({p_actor:'trusted',p_active:true,p_conversation:null}));});
it.each([{active:null},{emoji:'arbitrary'},{messageId:'bad'},{kind:'other'},{room:'bad'},{action:'toggle'}])('rejects malformed mutation %j',async data=>{expect((await POST(req(data))).status).toBe(400);expect(m.rpc).not.toHaveBeenCalled();});
it('rejects cross origin before auth',async()=>{m.origin.mockReturnValue(false);expect((await POST(req())).status).toBe(403);expect(m.auth).not.toHaveBeenCalled();});
it('requires authenticated access',async()=>{m.auth.mockResolvedValue({ok:false,status:401,error:'unauthorized'});expect((await POST(req())).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled();});
it('denies unentitled SS room',async()=>{expect((await POST(req({room:'shortscout'}))).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();});
it('batches scoped reads and bounds IDs',async()=>{expect((await POST(req({action:'read',messageIds:[id]}))).status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('read_chat_message_reactions',expect.objectContaining({p_messages:[id],p_room:'social'}));expect((await POST(req({action:'read',messageIds:Array(101).fill(id)}))).status).toBe(400);});
it('passes trusted DM scope without a public room',async()=>{expect((await POST(req({kind:'dm',conversationId:id}))).status).toBe(200);expect(m.rpc).toHaveBeenCalledWith('set_chat_message_reaction',expect.objectContaining({p_room:null,p_conversation:id}));});
it.each([['chat_paused',423],['conversation_unavailable',403],['conversation_not_found',404],['message_not_found',404],['room_forbidden',403],['sensitive database detail',503]])('maps %s safely',async(error,status)=>{m.rpc.mockResolvedValue({error:{message:error}});const r=await POST(req());expect(r.status).toBe(status);if(status===503)expect(await r.json()).toEqual({error:'reactions_unavailable'});});

it('details authorize the exact message before reading any names',async()=>{
 m.rpc.mockResolvedValue({error:{message:'conversation_unavailable'}});
 expect((await POST(req({action:'details',kind:'dm',conversationId:id}))).status).toBe(403);
 expect(m.from).not.toHaveBeenCalled();
 expect(m.rpc).toHaveBeenCalledWith('check_chat_reaction_target',expect.objectContaining({p_actor:'trusted',p_message:id,p_conversation:id,p_write:false}));
});
it.each([{after:'invalid'},{emoji:'invalid'}])('rejects malformed details %j',async extra=>{expect((await POST(req({action:'details',...extra}))).status).toBe(400);expect(m.from).not.toHaveBeenCalled();});
it.each([['room','like','longboard_chat_reactions','guest_id','message_id'],['room','heart','chat_message_reaction_choices','member_id','room_message_id'],['dm','laugh','chat_message_reaction_choices','member_id','dm_message_id'],['room','rob','chat_message_reaction_choices','member_id','room_message_id'],['dm','rob','chat_message_reaction_choices','member_id','dm_message_id']])('pages bounded %s %s names',async(kind,emoji,table,column,messageColumn)=>{
 const data=Array.from({length:51},(_,i)=>({[column]:String(i),person:{display_name:'Name '+i},secret:'never exposed'}));
 const q={select:vi.fn(),eq:vi.fn(),gt:vi.fn(),order:vi.fn(),limit:vi.fn().mockResolvedValue({data})};
 for(const method of ['select','eq','gt','order'] as const)q[method].mockReturnValue(q);m.from.mockReturnValue(q);
 const result=await POST(req({action:'details',kind,emoji,conversationId:id,after:id}));
 expect(result.status).toBe(200);const body=await result.json();expect(body.people).toHaveLength(50);expect(body.nextCursor).toBe('49');expect(body.people[0]).toEqual({id:'0',name:'Name 0'});
 expect(m.from).toHaveBeenCalledWith(table);expect(q.eq).toHaveBeenCalledWith(messageColumn,id);expect(q.gt).toHaveBeenCalledWith(column,id);expect(q.order).toHaveBeenCalledWith(column,{ascending:true});expect(q.limit).toHaveBeenCalledWith(51);
});
