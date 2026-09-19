import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {GET} from '@/app/api/cron/chat-attachments/route';
const mock=vi.hoisted(()=>({admin:vi.fn(),remove:vi.fn(),ack:vi.fn()}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:mock.admin}));
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv('CRON_SECRET','test-cleanup');
 mock.remove.mockResolvedValue({error:null});
 mock.admin.mockReturnValue({storage:{from:()=>({remove:mock.remove})},from:(table:string)=>{
  let removing=false;
  const q={select:()=>q,delete:()=>{removing=true;return q;},lt:()=>q,lte:()=>q,neq:()=>q,order:()=>q,
   limit:async()=>({error:null,data:table==='chat_attachments'?[{id:'orphan'}]:[{path:'quarantine/expired'},{path:'clean/deleted'},{path:'previews/deleted.webp'}]}),
   in:(_column:string,paths:string[])=>{if(table==='chat_attachment_deletions'&&removing)mock.ack(paths);return q;},
   then:(resolve:(v:unknown)=>void)=>Promise.resolve({error:null}).then(resolve)};return q;
 }});
});
const req=(auth='Bearer test-cleanup')=>new NextRequest('https://example.test/api/cron/chat-attachments',{headers:{authorization:auth}});
it('rejects callers without the cron secret before touching storage',async()=>{expect((await GET(req('wrong'))).status).toBe(401);expect(mock.admin).not.toHaveBeenCalled();});
it('acknowledges cleanup only after storage removal succeeds',async()=>{
 const response=await GET(req());expect(response.status).toBe(200);expect(mock.remove).toHaveBeenCalledWith(['quarantine/expired','clean/deleted','previews/deleted.webp']);expect(mock.ack).toHaveBeenCalledWith(['quarantine/expired','clean/deleted','previews/deleted.webp']);
});
it('retains the deletion queue for retry when storage is unavailable',async()=>{
 mock.remove.mockResolvedValue({error:{message:'unavailable'}});expect((await GET(req())).status).toBe(503);expect(mock.ack).not.toHaveBeenCalled();
});
