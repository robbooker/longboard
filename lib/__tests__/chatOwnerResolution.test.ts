import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {NextRequest} from 'next/server';
const m=vi.hoisted(()=>({admin:vi.fn(),lookup:vi.fn(),from:vi.fn()}));
vi.mock('@/lib/auth',()=>({requireAdmin:m.admin}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>({from:m.from})}));
import {requireChatOwner} from '@/lib/chatAdmin';
const request=new NextRequest('https://example.test/api/chat/admin?room=social');
const user={id:'alice',email:'alice@example.test',role:'admin' as const};
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.test');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','synthetic');m.admin.mockResolvedValue({ok:true,user});m.lookup.mockResolvedValue({data:{user_id:'alice'},error:null});m.from.mockReturnValue({select:()=>({eq:()=>({maybeSingle:m.lookup})})});});
afterEach(()=>vi.unstubAllEnvs());
it('reuses request-local verified admin identity but still checks current ownership',async()=>{
 expect((await requireChatOwner(request,{ok:true,user})).ok).toBe(true);expect(m.admin).not.toHaveBeenCalled();expect(m.from).toHaveBeenCalledWith('longboard_chat_owners');
 m.lookup.mockResolvedValue({data:null,error:null});expect(await requireChatOwner(request,{ok:true,user})).toMatchObject({ok:false,status:403});
});
it('does not elevate a verified ordinary or cookie-only member',async()=>{
 expect(await requireChatOwner(request,{ok:true,user:{...user,role:'user'}})).toMatchObject({ok:false,status:403});expect(m.from).not.toHaveBeenCalled();
});
it('keeps the existing authoritative path for callers without a verified identity',async()=>{
 expect((await requireChatOwner(request)).ok).toBe(true);expect(m.admin).toHaveBeenCalledWith(request);
 m.admin.mockResolvedValue({ok:false,status:401,error:'unauthenticated'});expect(await requireChatOwner(request)).toMatchObject({ok:false,status:401});
});
it('fails closed on ownership lookup errors',async()=>{
 m.lookup.mockResolvedValue({data:null,error:{message:'unavailable'}});expect(await requireChatOwner(request,{ok:true,user})).toMatchObject({ok:false,status:500});
});
