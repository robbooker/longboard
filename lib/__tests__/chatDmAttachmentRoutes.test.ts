import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {GET,POST,DELETE} from '@/app/api/chat/attachments/[id]/route';
import {GET as list,POST as reserve} from '@/app/api/chat/attachments/route';
const mocks=vi.hoisted(()=>({auth:vi.fn(),admin:vi.fn(),member:vi.fn(),scan:vi.fn(),origin:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mocks.auth}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:mocks.admin,requestOriginAllowed:mocks.origin,readPublicRoomState:vi.fn()}));
vi.mock('@/lib/chatMembers',()=>({findChatMember:mocks.member,CHAT_UUID:/^[a-f\d-]{36}$/i}));
vi.mock('@/lib/chatMalwareScan',()=>({scanAttachment:mocks.scan,scannerConfigured:()=>true,MalwareScanError:class extends Error{}}));
const id='10000000-0000-4000-8000-000000000001',conversation='20000000-0000-4000-8000-000000000001',otherConversation='20000000-0000-4000-8000-000000000002',member='alice',recipient='bob',message='30000000-0000-4000-8000-000000000001';
let tables:Record<string,Record<string,unknown>[]>,storage:Record<string,ReturnType<typeof vi.fn>>,rpc:ReturnType<typeof vi.fn>;
function builder(table:string){
 const filters:((row:Record<string,unknown>)=>boolean)[]=[];let remove=false;
 const exec=()=>{const rows=(tables[table]??[]).filter(row=>filters.every(filter=>filter(row)));if(remove)tables[table]=tables[table].filter(row=>!rows.includes(row));return {data:rows,error:null};};
 const q={select:()=>q,delete:()=>{remove=true;return q;},eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return q;},neq:(key:string,value:unknown)=>{filters.push(row=>row[key]!==value);return q;},is:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return q;},in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(row[key]));return q;},contains:(key:string,values:unknown[])=>{filters.push(row=>values.every(value=>(row[key] as unknown[]).includes(value)));return q;},or:(value:string)=>{filters.push(row=>value.split(',').some(part=>{const [key,,match]=part.split('.');return row[key]===match;}));return q;},limit:()=>q,maybeSingle:async()=>({data:exec().data[0]??null,error:null}),then:(resolve:(value:ReturnType<typeof exec>)=>void)=>Promise.resolve(exec()).then(resolve)};
 return q;
}
const ctx={params:Promise.resolve({id})};
const req=(method='GET',query='')=>new NextRequest(`https://example.test/api/chat/attachments/${id}${query}`,{method});
const metadata=(scope:Record<string,string>={conversationId:conversation})=>new NextRequest('https://example.test/api/chat/attachments',{method:'POST',body:JSON.stringify({...scope,filename:'private.png',mime_type:'image/png',byte_size:8})});
const listing=(scope=`conversationId=${conversation}`)=>new NextRequest(`https://example.test/api/chat/attachments?${scope}&ids=${id}`);
beforeEach(()=>{
 vi.clearAllMocks();mocks.auth.mockResolvedValue({ok:true,user:{id:'account'},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});mocks.member.mockResolvedValue({id:member});mocks.origin.mockReturnValue(true);
 tables={chat_attachments:[{id,member_id:member,room_slug:null,conversation_id:conversation,dm_message_id:message,status:'attached',object_path:'clean/private',filename:'private.png',mime_type:'image/png',byte_size:8}],longboard_chat_conversations:[{id:conversation,requester_id:member,recipient_id:recipient,status:'accepted'},{id:otherConversation,requester_id:member,recipient_id:'carol',status:'accepted'}],longboard_chat_direct_messages:[{id:message,conversation_id:conversation,attachment_ids:[id],deleted_at:null}],longboard_chat_blocks:[]};
 storage={createSignedUrl:vi.fn(async()=>({data:{signedUrl:'https://storage.test/private'},error:null})),createSignedUploadUrl:vi.fn(async()=>({data:{signedUrl:'https://storage.test/quarantine'},error:null}))};rpc=vi.fn(async()=>({data:{id,upload_path:'quarantine/private'},error:null}));mocks.admin.mockReturnValue({from:builder,rpc,storage:{from:()=>storage}});
});
describe('private DM attachment boundaries',()=>{
 it('allows both participants short-lived private previews and metadata',async()=>{
  for(const who of [member,recipient]){mocks.member.mockResolvedValue({id:who});const response=await GET(req('GET','?preview=1'),ctx);expect(response.status).toBe(302);expect(response.headers.get('cache-control')).toBe('private, no-store');expect((await (await list(listing())).json()).files).toHaveLength(1);}
  expect(storage.createSignedUrl).toHaveBeenCalledWith('clean/private',60,{});
 });
 it('denies outsiders, including guessed preview/download and metadata IDs',async()=>{
  mocks.member.mockResolvedValue({id:'mallory'});expect((await GET(req(),ctx)).status).toBe(404);expect((await GET(req('GET','?preview=1'),ctx)).status).toBe(404);expect((await list(listing())).status).toBe(404);expect((await reserve(metadata())).status).toBe(404);expect(storage.createSignedUrl).not.toHaveBeenCalled();
 });
 it('does not substitute a private attachment into another conversation or public room',async()=>{
  expect((await (await list(listing(`conversationId=${otherConversation}`))).json()).files).toEqual([]);
  expect((await (await list(listing('room=main'))).json()).files).toEqual([]);
  tables.chat_attachments[0].conversation_id=otherConversation;expect((await GET(req(),ctx)).status).toBe(404);
 });
 it.each(['deleted','missing','unlinked','draft'])('rejects %s message files from metadata and download',async mode=>{
  if(mode==='deleted')tables.longboard_chat_direct_messages[0].deleted_at='now';
  if(mode==='missing')tables.longboard_chat_direct_messages=[];
  if(mode==='unlinked')tables.longboard_chat_direct_messages[0].attachment_ids=[];
  if(mode==='draft')tables.chat_attachments[0].status='ready';
  expect((await GET(req(),ctx)).status).toBe(404);expect((await (await list(listing())).json()).files).toEqual([]);expect(storage.createSignedUrl).not.toHaveBeenCalled();
 });
 it('reserves through the private RPC using the verified member and excludes mixed scopes',async()=>{
  expect((await reserve(metadata())).status).toBe(200);expect(rpc).toHaveBeenCalledWith('reserve_chat_dm_attachment',expect.objectContaining({sender:member,conversation}));expect((await reserve(metadata({conversationId:conversation,room:'main'}))).status).toBe(400);
 });
 it.each(['pending','declined','blocked'])('denies %s upload and scan without preventing owner cancellation',async mode=>{
  tables.chat_attachments[0].status='pending';
  if(mode==='blocked')tables.longboard_chat_blocks=[{blocker_id:recipient,blocked_id:member}];else tables.longboard_chat_conversations[0].status=mode;
  expect((await reserve(metadata())).status).toBe(409);expect((await POST(req('POST'),ctx)).status).toBe(409);expect((await DELETE(req('DELETE'),ctx)).status).toBe(200);expect(mocks.scan).not.toHaveBeenCalled();
 });
 it('only lets an owner cancel, and never deletes an attached file through cancellation',async()=>{
  expect((await DELETE(req('DELETE'),ctx)).status).toBe(200);expect(tables.chat_attachments).toHaveLength(1);
  tables.chat_attachments[0].status='pending';mocks.member.mockResolvedValue({id:recipient});expect((await DELETE(req('DELETE'),ctx)).status).toBe(404);expect((await POST(req('POST'),ctx)).status).toBe(404);expect(tables.chat_attachments).toHaveLength(1);
 });
});
