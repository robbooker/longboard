import {beforeEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({member:vi.fn(),room:vi.fn(),history:vi.fn(),counts:vi.fn(),features:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:()=>({}),readPublicRoomState:m.room}));
vi.mock('@/lib/chatMembers',()=>({findChatMember:m.member}));
vi.mock('@/lib/chatReads/history',()=>({readHistory:m.history}));
vi.mock('@/lib/chatReads/counts',()=>({readCounts:m.counts}));
vi.mock('@/lib/chatFeatures',()=>({featureAccess:m.features}));
import {loadChatBootstrap} from '@/lib/chatBootstrap';
import type {ChatAuthResult} from '@/lib/chatAuth';
const auth:ChatAuthResult={ok:true,user:{id:'alice',email:'alice@example.test',role:'user'},access:{longboard:true,boardroom:false,shortscout:false,admin:false},serverSession:false};
beforeEach(()=>{vi.clearAllMocks();m.member.mockResolvedValue({id:'member',display_name:'Alice'});m.room.mockResolvedValue({isOpen:true});m.history.mockImplementation(async()=>Response.json({messages:[{id:'message'}],reactions:[]}));m.counts.mockImplementation(async()=>Response.json({counts:{message:2}}));m.features.mockResolvedValue(null);});
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
