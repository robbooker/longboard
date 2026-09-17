import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {createHash} from 'node:crypto';
import {GET,POST,DELETE} from '@/app/api/chat/attachments/[id]/route';
const mocks=vi.hoisted(()=>({auth:vi.fn(),admin:vi.fn(),member:vi.fn(),scan:vi.fn(),open:vi.fn(),origin:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mocks.auth}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:mocks.admin,readPublicRoomState:mocks.open,requestOriginAllowed:mocks.origin}));
vi.mock('@/lib/chatMembers',()=>({findChatMember:mocks.member,CHAT_UUID:/^[a-f\d-]{36}$/i}));
vi.mock('@/lib/chatMalwareScan',()=>({scanAttachment:mocks.scan,MalwareScanError:class extends Error{}}));
const id='10000000-0000-4000-8000-000000000001';
const memberId='20000000-0000-4000-8000-000000000001';
const clean=new Uint8Array([71,73,70,56,57,97,0,0]);
let file:Record<string,unknown>|null,linked:boolean,storage:Record<string,ReturnType<typeof vi.fn>>,stored:Uint8Array;
function builder(table:string){
 let mutation:Record<string,unknown>|null=null,remove=false;
 const filters:((row:Record<string,unknown>)=>boolean)[]=[];
 const exec=()=>{
  let row=table==='chat_attachments'?file:linked?{id:'message',room_slug:'main',attachment_ids:[id]}:null;
  if(row&&filters.some(f=>!f(row!)))row=null;
  if(row&&mutation)Object.assign(row,mutation);
  const data=row?{...row}:null;
  if(row&&remove)file=null;
  return {data,error:null};
 };
 const q={select:()=>q,update:(v:Record<string,unknown>)=>{mutation=v;return q;},delete:()=>{remove=true;return q;},
  eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q;},neq:(k:string,v:unknown)=>{filters.push(r=>r[k]!==v);return q;},contains:()=>q,
  maybeSingle:async()=>exec(),then:(resolve:(v:ReturnType<typeof exec>)=>void)=>Promise.resolve(exec()).then(resolve)};
 return q;
}
const ctx={params:Promise.resolve({id})};
const req=(method='POST',query='')=>new NextRequest(`https://example.test/api/chat/attachments/${id}${query}`,{method});
beforeEach(()=>{
 vi.clearAllMocks();stored=clean.slice();linked=true;
 file={id,member_id:memberId,room_slug:'main',filename:'tiny.gif',mime_type:'image/gif',byte_size:8,upload_path:`quarantine/${id}`,created_at:new Date().toISOString(),status:'pending'};
 mocks.auth.mockResolvedValue({ok:true,user:{id:'user'},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});
 mocks.member.mockResolvedValue({id:memberId});mocks.open.mockResolvedValue({isOpen:true});mocks.origin.mockReturnValue(true);mocks.scan.mockResolvedValue(undefined);
 storage={download:vi.fn(async()=>({data:new Blob([stored as BlobPart]),error:null})),upload:vi.fn(async()=>({error:null})),createSignedUrl:vi.fn(async()=>({data:{signedUrl:'https://storage.example/signed'},error:null}))};
 mocks.admin.mockReturnValue({from:builder,storage:{from:()=>storage}});
});
describe('attachment finalization and downloads',()=>{
 it('saves exactly the scanned bytes at an immutable server-only path',async()=>{
  mocks.scan.mockImplementation(async(bytes:Uint8Array)=>{expect(bytes).toEqual(clean);stored=new Uint8Array([0,0]);});
  expect((await POST(req(),ctx)).status).toBe(200);expect(file?.status).toBe('ready');
  expect(file?.sha256).toBe(createHash('sha256').update(clean).digest('hex'));
  expect(storage.upload).toHaveBeenCalledWith(expect.stringMatching(/^clean\//),clean,expect.objectContaining({upsert:false,contentType:'image/gif'}));
  expect(storage.createSignedUrl).not.toHaveBeenCalled();
 });
 it.each(['wrong-size','wrong-type','scanner-error','storage-error'])('never publishes %s',async mode=>{
  if(mode==='wrong-size')stored=new Uint8Array([1]);
  if(mode==='wrong-type')stored=new Uint8Array(8);
  if(mode==='scanner-error')mocks.scan.mockRejectedValue(Error('unavailable'));
  if(mode==='storage-error')storage.upload.mockResolvedValue({error:{message:'unavailable'}});
  expect((await POST(req(),ctx)).status).toBeGreaterThanOrEqual(400);expect(file?.status).toBe('rejected');
  if(mode!=='storage-error')expect(storage.upload).not.toHaveBeenCalled();
  expect((await GET(req('GET'),ctx)).status).toBe(404);
 });
 it('does not rescan a pending lease or expired upload',async()=>{
  file!.status='scanning';expect((await POST(req(),ctx)).status).toBe(409);
  file!.status='pending';file!.created_at=new Date(Date.now()-3*3600000).toISOString();expect((await POST(req(),ctx)).status).toBe(410);expect(mocks.scan).not.toHaveBeenCalled();
 });
 it('fails closed if cancellation deletes metadata during a scan',async()=>{
  mocks.scan.mockImplementation(async()=>{file=null;});expect((await POST(req(),ctx)).status).toBe(409);
 });
 it('rejects another member finalizing or cancelling a file',async()=>{
  mocks.member.mockResolvedValue({id:'someone-else'});expect((await POST(req(),ctx)).status).toBe(404);expect((await DELETE(req('DELETE'),ctx)).status).toBe(404);expect(mocks.scan).not.toHaveBeenCalled();
 });
 it('requires authentication, current room access, and an open room to finalize',async()=>{
  mocks.auth.mockResolvedValueOnce({ok:false,status:401,error:'unauthenticated'});expect((await POST(req(),ctx)).status).toBe(401);
  mocks.auth.mockResolvedValueOnce({ok:true,user:{id:'user'},access:{longboard:false,shortscout:true,admin:false}});expect((await POST(req(),ctx)).status).toBe(404);
  mocks.open.mockResolvedValue({isOpen:false});expect((await POST(req(),ctx)).status).toBe(423);expect(mocks.scan).not.toHaveBeenCalled();
 });
 it('denies cross-origin writes',async()=>{mocks.origin.mockReturnValue(false);expect((await POST(req(),ctx)).status).toBe(403);expect(mocks.scan).not.toHaveBeenCalled();});
 it('never downloads a draft, deleted message, or revoked room attachment',async()=>{
  expect((await GET(req('GET'),ctx)).status).toBe(404);
  Object.assign(file!,{status:'attached',room_message_id:'message',object_path:'clean/file'});linked=false;expect((await GET(req('GET'),ctx)).status).toBe(404);
  linked=true;mocks.auth.mockResolvedValue({ok:true,user:{id:'user'},access:{longboard:false,shortscout:true,admin:false}});expect((await GET(req('GET'),ctx)).status).toBe(404);expect(storage.createSignedUrl).not.toHaveBeenCalled();
 });
 it('issues only short-lived private links and forces PDFs to download',async()=>{
  Object.assign(file!,{status:'attached',room_message_id:'message',object_path:'clean/file',mime_type:'application/pdf',filename:'notes.pdf'});
  const response=await GET(req('GET','?preview=1'),ctx);expect(response.status).toBe(302);expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(storage.createSignedUrl).toHaveBeenCalledWith('clean/file',60,{download:'notes.pdf'});
 });
});
