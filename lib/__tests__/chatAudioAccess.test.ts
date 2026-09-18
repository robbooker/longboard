import {beforeEach,describe,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {audioAccess} from '@/lib/chatAudioAccess';
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
const req=(method='GET',query='')=>new NextRequest(`https://example.test/api/chat/attachments/${id}${query}`,{method});
beforeEach(()=>{
 vi.clearAllMocks();mocks.auth.mockResolvedValue({ok:true,user:{id:'account'},access:{longboard:true,boardroom:true,shortscout:false,admin:false}});mocks.member.mockResolvedValue({id:member});mocks.origin.mockReturnValue(true);
 tables={chat_attachments:[{id,member_id:member,room_slug:null,conversation_id:conversation,dm_message_id:message,status:'attached',object_path:'clean/private',filename:'voice.wav',mime_type:'audio/wav',byte_size:32044}],longboard_chat_conversations:[{id:conversation,requester_id:member,recipient_id:recipient,status:'accepted'},{id:otherConversation,requester_id:member,recipient_id:'carol',status:'accepted'}],longboard_chat_direct_messages:[{id:message,conversation_id:conversation,attachment_ids:[id],deleted_at:null}],longboard_chat_blocks:[]};
 storage={createSignedUrl:vi.fn(async()=>({data:{signedUrl:'https://storage.test/private'},error:null})),createSignedUploadUrl:vi.fn(async()=>({data:{signedUrl:'https://storage.test/quarantine'},error:null}))};rpc=vi.fn(async()=>({data:{id,upload_path:'quarantine/private'},error:null}));mocks.admin.mockReturnValue({from:builder,rpc,storage:{from:()=>storage}});
});
describe('fresh audio authorization',()=>{
 it('authorizes either current participant, without trusting attachment ownership',async()=>{for(const who of [member,recipient]){mocks.member.mockResolvedValue({id:who});expect((await audioAccess(req(),id)).member.id).toBe(who);}});
 it.each(['outsider','declined','pending','blocked-sender','blocked-recipient','deleted','unlinked','substituted','unscanned','revoked','unauthenticated'])('denies %s playback/transcription',async mode=>{
  if(mode==='outsider')mocks.member.mockResolvedValue({id:'mallory'});
  if(mode==='declined'||mode==='pending')tables.longboard_chat_conversations[0].status=mode;
  if(mode.startsWith('blocked'))tables.longboard_chat_blocks=[mode==='blocked-sender'?{blocker_id:member,blocked_id:recipient}:{blocker_id:recipient,blocked_id:member}];
  if(mode==='deleted')tables.longboard_chat_direct_messages[0].deleted_at='now';
  if(mode==='unlinked')tables.longboard_chat_direct_messages[0].attachment_ids=[];
  if(mode==='substituted')tables.chat_attachments[0].conversation_id=otherConversation;
  if(mode==='unscanned')tables.chat_attachments[0].status='pending';
  if(mode==='revoked')mocks.auth.mockResolvedValue({ok:true,user:{id:'account'},access:{longboard:false,shortscout:false,admin:false}});
  if(mode==='unauthenticated')mocks.auth.mockResolvedValue({ok:false,status:401,error:'unauthenticated'});
  await expect(audioAccess(req(),id)).rejects.toThrow();
 });
});
