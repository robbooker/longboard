import {NextRequest,NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {createChatAdminClient} from '@/lib/chatAdmin';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:NextRequest){
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 const raw=req.nextUrl.searchParams.get('q')??'';
 const query=raw.normalize('NFKC').replace(/\s+/g,' ').trim();
 if(raw.length>112||query.length<2||query.length>28||req.nextUrl.searchParams.getAll('q').length>1||!/^[\p{L}\p{N} _.'-]*$/u.test(query))return json({error:'Search using 2–28 characters from a chat name.'},400);
 const admin=createChatAdminClient();if(!admin)return json({error:'Member search is unavailable. Please try again.'},503);
 try{
  const {data,error}=await admin.rpc('longboard_chat_dm_directory',{p_user_id:auth.user.id,p_query:query});
  if(error)return json({error:error.message==='member_required'?'Choose your chat name before starting a DM.':'Member search is unavailable. Please try again.'},error.message==='member_required'?403:503);
  // Explicit projection prevents account IDs or future RPC fields reaching the browser.
  return json({members:(data??[]).map((member:{id:string;display_name:string})=>({id:member.id,display_name:member.display_name}))});
 }catch{return json({error:'Member search is unavailable. Please try again.'},503);}
}
