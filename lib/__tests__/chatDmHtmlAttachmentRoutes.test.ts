// D-308: HTML files in DMs. HTML can run scripts, so every route that serves an attachment
// must hand it out only as a forced download, never inline and never as a signed storage link.
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {createHash} from 'node:crypto';
import {GET,POST} from '@/app/api/chat/attachments/[id]/route';
import {GET as list,POST as reserve} from '@/app/api/chat/attachments/route';
import {attachmentContentDisposition,safeDownloadFilename} from '@/lib/chatAttachmentDownload';
const mocks=vi.hoisted(()=>({auth:vi.fn(),admin:vi.fn(),member:vi.fn(),scan:vi.fn(),origin:vi.fn(),open:vi.fn()}));
vi.mock('@/lib/chatAuth',()=>({requireChatUser:mocks.auth}));
vi.mock('@/lib/chatAdmin',()=>({createChatAdminClient:mocks.admin,requestOriginAllowed:mocks.origin,readPublicRoomState:mocks.open}));
vi.mock('@/lib/chatMembers',()=>({findChatMember:mocks.member,CHAT_UUID:/^[a-f\d-]{36}$/i}));
vi.mock('@/lib/chatMalwareScan',()=>({scanAttachment:mocks.scan,scannerConfigured:()=>true,MalwareScanError:class extends Error{}}));
const id='10000000-0000-4000-8000-000000000001',conversation='20000000-0000-4000-8000-000000000001',member='alice',recipient='bob',message='30000000-0000-4000-8000-000000000001';
const html=new TextEncoder().encode('<!doctype html><script>alert(document.cookie)</script><p>Chart notes</p>');
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
let tables:Record<string,Record<string,unknown>[]>,storage:Record<string,ReturnType<typeof vi.fn>>,rpc:ReturnType<typeof vi.fn>,stored:Uint8Array;
function builder(table:string){
 const filters:((row:Record<string,unknown>)=>boolean)[]=[];let patch:Record<string,unknown>|null=null;
 const exec=()=>{const rows=(tables[table]??[]).filter(row=>filters.every(filter=>filter(row)));if(patch)for(const row of rows)Object.assign(row,patch);return {data:rows.map(row=>({...row})),error:null};};
 const q={select:()=>q,update:(value:Record<string,unknown>)=>{patch=value;return q;},eq:(key:string,value:unknown)=>{filters.push(row=>row[key]===value);return q;},neq:(key:string,value:unknown)=>{filters.push(row=>row[key]!==value);return q;},is:(key:string,value:unknown)=>{filters.push(row=>(row[key]??null)===value);return q;},in:(key:string,values:unknown[])=>{filters.push(row=>values.includes(row[key]));return q;},contains:(key:string,values:unknown[])=>{filters.push(row=>values.every(value=>(row[key] as unknown[]).includes(value)));return q;},or:(value:string)=>{filters.push(row=>value.split(',').some(part=>{const [key,,match]=part.split('.');return row[key]===match;}));return q;},limit:()=>q,maybeSingle:async()=>({data:exec().data[0]??null,error:null}),then:(resolve:(value:ReturnType<typeof exec>)=>void)=>Promise.resolve(exec()).then(resolve)};
 return q;
}
const ctx={params:Promise.resolve({id})};
const req=(method='GET',query='')=>new NextRequest(`https://example.test/api/chat/attachments/${id}${query}`,{method});
const metadata=(scope:Record<string,string>,filename='chart-notes.html',mime='text/html')=>new NextRequest('https://example.test/api/chat/attachments',{method:'POST',body:JSON.stringify({...scope,filename,mime_type:mime,byte_size:html.length})});
const file=()=>tables.chat_attachments[0];
beforeEach(()=>{
 vi.clearAllMocks();stored=html.slice();
 mocks.auth.mockResolvedValue({ok:true,user:{id:'account'},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});mocks.member.mockResolvedValue({id:member});mocks.origin.mockReturnValue(true);mocks.open.mockResolvedValue({isOpen:true});mocks.scan.mockResolvedValue(undefined);
 tables={chat_attachments:[{id,member_id:member,room_slug:null,conversation_id:conversation,dm_message_id:message,status:'attached',object_path:'clean/page',upload_path:`quarantine/${id}`,filename:'chart-notes.html',mime_type:'text/html',byte_size:html.length,sha256:sha(html),created_at:new Date().toISOString()}],longboard_chat_conversations:[{id:conversation,requester_id:member,recipient_id:recipient,status:'accepted'}],longboard_chat_direct_messages:[{id:message,conversation_id:conversation,attachment_ids:[id],deleted_at:null}],longboard_chat_blocks:[]};
 storage={download:vi.fn(async()=>({data:new Blob([stored as BlobPart]),error:null})),upload:vi.fn(async()=>({error:null})),createSignedUrl:vi.fn(async()=>({data:{signedUrl:'https://storage.test/private'},error:null})),createSignedUploadUrl:vi.fn(async()=>({data:{signedUrl:'https://storage.test/quarantine'},error:null}))};
 rpc=vi.fn(async()=>({data:{id,upload_path:`quarantine/${id}`},error:null}));mocks.admin.mockReturnValue({from:builder,rpc,storage:{from:()=>storage}});
});
function expectInertDownload(response:Response){
 expect(response.status).toBe(200);
 expect(response.headers.get('content-type')).toBe('application/octet-stream');
 expect(response.headers.get('content-type')).not.toMatch(/html/i);
 expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="chart-notes\.html"; filename\*=UTF-8''chart-notes\.html$/);
 expect(response.headers.get('x-content-type-options')).toBe('nosniff');
 expect(response.headers.get('content-security-policy')).toMatch(/^sandbox;/);
 expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
 expect(response.headers.get('cache-control')).toBe('private, no-store');
 expect(response.headers.get('location')).toBeNull();
}
describe('HTML uploads are DM-only on the server',()=>{
 it('reserves an HTML file in a DM',async()=>{
  const response=await reserve(metadata({conversationId:conversation}));
  expect(response.status).toBe(200);expect(rpc).toHaveBeenCalledWith('reserve_chat_dm_attachment',expect.objectContaining({mime:'text/html',name:'chart-notes.html'}));
 });
 it.each(['main','social','shortscout'])('refuses HTML in the %s room before reserving anything',async room=>{
  const response=await reserve(metadata({room}));
  expect(response.status).toBe(400);expect((await response.json()).error).toBe('Choose a PDF, JPEG, PNG, GIF or WAV voice file.');expect(rpc).not.toHaveBeenCalled();expect(storage.createSignedUploadUrl).not.toHaveBeenCalled();
 });
 it('still refuses other unsupported types in DMs with the DM wording',async()=>{
  const response=await reserve(metadata({conversationId:conversation},'x.svg','image/svg+xml'));
  expect(response.status).toBe(400);expect((await response.json()).error).toBe('Choose a PDF, JPEG, PNG, GIF, HTML or WAV voice file.');
 });
 it('scans HTML like a PDF and saves the exact scanned bytes',async()=>{
  Object.assign(file(),{status:'pending',object_path:null,sha256:null,dm_message_id:null});
  const response=await POST(req('POST'),ctx);
  expect(response.status).toBe(200);expect(mocks.scan).toHaveBeenCalledWith(html,'text/html');
  expect(storage.upload).toHaveBeenCalledWith(expect.stringMatching(/^clean\//),html,expect.objectContaining({contentType:'text/html'}));
  expect(file().status).toBe('ready');expect(file().sha256).toBe(sha(html));
 });
 it('rejects binary bytes posing as HTML without scanning them',async()=>{
  Object.assign(file(),{status:'pending',object_path:null,sha256:null,dm_message_id:null});stored=new Uint8Array([77,90,0,0,...html]);file().byte_size=stored.length;
  const response=await POST(req('POST'),ctx);
  expect(response.status).toBe(400);expect((await response.json()).error).toBe('The file contents do not match its type.');expect(mocks.scan).not.toHaveBeenCalled();expect(file().status).toBe('rejected');
 });
});
describe('HTML is only ever served as a forced download',()=>{
 it('download route: attachment, octet-stream, nosniff, sandbox CSP, no signed storage link',async()=>{
  for(const who of [member,recipient]){
   mocks.member.mockResolvedValue({id:who});
   const response=await GET(req(),ctx);expectInertDownload(response);
   expect(new Uint8Array(await response.arrayBuffer())).toEqual(html);
  }
  expect(storage.createSignedUrl).not.toHaveBeenCalled();
 });
 it('preview route (?preview=1) gives the same download, never an inline view',async()=>{
  const response=await GET(req('GET','?preview=1'),ctx);expectInertDownload(response);expect(storage.createSignedUrl).not.toHaveBeenCalled();
 });
 it.each(['?thumbnail=1','?play=1'])('%s has no preview for HTML',async query=>{
  const response=await GET(req('GET',query),ctx);expect(response.status).toBe(404);expect(response.headers.get('content-type')).toMatch(/json/);expect(storage.createSignedUrl).not.toHaveBeenCalled();expect(storage.download).not.toHaveBeenCalled();
 });
 it('even a (database-forbidden) room HTML row would only download',async()=>{
  Object.assign(file(),{conversation_id:null,room_slug:'main',dm_message_id:null,room_message_id:message});tables.longboard_chat_messages=[{id:message,room_slug:'main',attachment_ids:[id]}];
  expectInertDownload(await GET(req(),ctx));expect(storage.createSignedUrl).not.toHaveBeenCalled();
 });
 it('refuses bytes that changed after the scan',async()=>{
  stored=new TextEncoder().encode('<script>swapped()</script>'.padEnd(html.length,' '));
  const response=await GET(req(),ctx);expect(response.status).toBe(503);expect(response.headers.get('content-type')).toMatch(/json/);
 });
 it('denies outsiders and deleted messages',async()=>{
  mocks.member.mockResolvedValue({id:'mallory'});expect((await GET(req(),ctx)).status).toBe(404);
  mocks.member.mockResolvedValue({id:member});tables.longboard_chat_direct_messages[0].deleted_at='now';expect((await GET(req(),ctx)).status).toBe(404);
  expect(storage.download).not.toHaveBeenCalled();
 });
 it('file list marks HTML as having no thumbnail',async()=>{
  const response=await list(new NextRequest(`https://example.test/api/chat/attachments?conversationId=${conversation}&ids=${id}`));
  expect((await response.json()).files).toEqual([expect.objectContaining({id,mime_type:'text/html',thumbnail_available:false})]);
 });
 it('PDF downloads keep using a short signed link with a download disposition',async()=>{
  Object.assign(file(),{mime_type:'application/pdf',filename:'report.pdf'});
  const response=await GET(req(),ctx);expect(response.status).toBe(302);expect(storage.createSignedUrl).toHaveBeenCalledWith('clean/page',60,{download:'report.pdf'});
 });
});
describe('download filenames',()=>{
 it('keeps header-breaking characters out of the quoted name and encodes the real name',()=>{
  expect(safeDownloadFilename('a"b;c.html')).toBe('a_b_c.html');
  expect(safeDownloadFilename('Résumé 📈.html')).toBe('Resume .html');
  expect(attachmentContentDisposition('Résumé.html')).toBe(`attachment; filename="Resume.html"; filename*=UTF-8''R%C3%A9sum%C3%A9.html`);
  expect(safeDownloadFilename('...')).toBe('download');
  expect(safeDownloadFilename('.htaccess.html')).toBe('htaccess.html');
  const header=attachmentContentDisposition('a"b\r\nX-Evil: 1.html');
  expect(header).not.toMatch(/[\r\n]/);expect(header.startsWith('attachment; filename="')).toBe(true);
  expect(attachmentContentDisposition("it's (1).html")).toBe(`attachment; filename="it's (1).html"; filename*=UTF-8''it%27s%20%281%29.html`);
 });
});
