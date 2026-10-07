import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({member:vi.fn(),room:vi.fn(),history:vi.fn(),counts:vi.fn(),features:vi.fn(),opening:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({}),readPublicRoomState:m.room}));
vi.mock('@/lib/chatMembers',()=>({findChatMember:m.member}));
vi.mock('@/lib/chatReads/history',()=>({readHistory:m.history}));
vi.mock('@/lib/chatReads/counts',()=>({readCounts:m.counts}));
vi.mock('@/lib/chatFeatures',()=>({featureAccess:m.features}));
vi.mock('@/lib/chatRoomOpening',()=>({readRoomOpening:m.opening}));
import {loadChatBootstrap} from '@/lib/chatBootstrap';
import type {ChatAuthResult} from '@/lib/chatAuth';
const auth:ChatAuthResult={ok:true,user:{id:'alice',email:'alice@example.test',role:'user'},access:{longboard:true,boardroom:false,shortscout:false,admin:false},serverSession:false};
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({id:'member',display_name:'Alice'});m.room.mockResolvedValue({isOpen:true});m.history.mockImplementation(async()=>Response.json({messages:[{id:'message'}],reactions:[]}));m.counts.mockImplementation(async()=>Response.json({counts:{message:2}}));m.features.mockResolvedValue(null);m.opening.mockResolvedValue({ok:true,body:{messageId:null,unreadMessageId:null,parentId:null,readThrough:0,latestThrough:0}});});
it('uses the same verified identity for initial private data and includes counts',async()=>{
 const result=await loadChatBootstrap(auth,'social');expect(result).toMatchObject({accountId:'alice',room:'social',counts:{message:2},member:{id:'member'},featureChannel:false});
 expect(m.features).toHaveBeenCalledWith(auth);expect(m.history.mock.calls[0][1]).toBe(auth);expect(m.counts.mock.calls[0][1]).toBe(auth);expect(m.member).toHaveBeenCalledWith(expect.anything(),'alice');
});
it('rejects forbidden rooms and signed-out sessions before any private reads',async()=>{
 await expect(loadChatBootstrap(auth,'main')).rejects.toThrow('room_forbidden');
 await expect(loadChatBootstrap({ok:false,status:401,error:'unauthenticated'},'social')).rejects.toThrow();expect(m.member).not.toHaveBeenCalled();expect(m.history).not.toHaveBeenCalled();
});
it('overlaps member, state, feature and history reads',async()=>{
 let release!:()=>void;m.member.mockReturnValue(new Promise(r=>release=()=>r(null)));const result=loadChatBootstrap(auth,'social');
 expect(m.room).toHaveBeenCalled();expect(m.history).toHaveBeenCalled();expect(m.features).toHaveBeenCalled();release();await result;
});
it('returns a name-setup state for first-time members without inventing identity',async()=>{m.member.mockResolvedValue(null);expect((await loadChatBootstrap(auth,'social')).member).toBeNull();});
it('fails closed for history failure but tolerates optional count failure',async()=>{
 m.counts.mockImplementation(async()=>Response.json({error:'unavailable'},{status:503}));expect((await loadChatBootstrap(auth,'social')).counts).toEqual({});
 m.history.mockImplementation(async()=>Response.json({error:'unavailable'},{status:503}));await expect(loadChatBootstrap(auth,'social')).rejects.toThrow('history_unavailable');
});
it('never caches private results between accounts or requests',async()=>{
 await loadChatBootstrap(auth,'social');m.member.mockResolvedValue({id:'bob-member'});
 const bob={...auth,user:{id:'bob',email:'bob@example.test',role:'user' as const}};
 expect(await loadChatBootstrap(bob,'social')).toMatchObject({accountId:'bob',member:{id:'bob-member'}});expect(m.member).toHaveBeenLastCalledWith(expect.anything(),'bob');expect(m.history).toHaveBeenCalledTimes(2);
});

const landing=(messageId:string|null,extra={})=>({ok:true,body:{messageId,unreadMessageId:messageId,parentId:null,readThrough:41,latestThrough:90,...extra}});
it('lands on an unread message already in the latest page without another history read',async()=>{
 m.opening.mockResolvedValue(landing('message'));
 const result=await loadChatBootstrap(auth,'social');
 expect(result.opening).toEqual({messageId:'message',unreadMessageId:'message',parentId:null,readThrough:41,window:null});
 expect(m.history).toHaveBeenCalledTimes(1);expect(m.opening).toHaveBeenCalledWith(expect.anything(),'alice','member','social');
});
it('loads a page around an older unread anchor and reports its window',async()=>{
 m.opening.mockResolvedValue(landing('older'));
 m.history.mockImplementation(async(req:{nextUrl:URL})=>req.nextUrl.searchParams.get('around')==='older'
  ?Response.json({messages:[{id:'before'},{id:'older'}],reactions:[],range:'10,50',hasMore:true,hasNewer:true})
  :Response.json({messages:[{id:'message'}],reactions:[]}));
 const result=await loadChatBootstrap(auth,'social');
 expect(result.messages.map(row=>row.id)).toEqual(['before','older']);
 expect(result.opening?.window).toEqual({range:'10,50',hasMore:true,hasNewer:true});
});
it('falls back to the latest page and a client lookup when the landing spot is unavailable',async()=>{
 m.opening.mockRejectedValue(new Error('down'));
 const result=await loadChatBootstrap(auth,'social');expect(result.opening).toBeUndefined();expect(result.messages).toEqual([{id:'message'}]);
 m.opening.mockResolvedValue(landing('older'));
 m.history.mockImplementation(async(req:{nextUrl:URL})=>req.nextUrl.searchParams.get('around')?Response.json({error:'unavailable'},{status:503}):Response.json({messages:[{id:'message'}],reactions:[]}));
 const fallback=await loadChatBootstrap(auth,'social');expect(fallback.opening).toBeUndefined();expect(fallback.messages).toEqual([{id:'message'}]);
});
it('does not look up a landing spot before a member name exists',async()=>{m.member.mockResolvedValue(null);expect((await loadChatBootstrap(auth,'social')).opening).toBeUndefined();expect(m.opening).not.toHaveBeenCalled();});
