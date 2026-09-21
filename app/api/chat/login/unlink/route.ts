import {NextRequest,NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {createChatAdminClient,requestOriginAllowed} from '@/lib/chatAdmin';
export async function POST(req:NextRequest){
 const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(!requestOriginAllowed(req))return json({error:'origin_not_allowed'},403);
 // Only the current LB login can revoke its own membership bridge.
 const auth=await getCurrentUser();if(!auth.ok)return json({error:'longboard_login_required'},401);
 const db=createChatAdminClient();if(!db)return json({error:'unavailable'},503);
 const {error}=await db.rpc('revoke_chat_shortscout_membership_link',{p_lb_user:auth.user.id});
 return error?json({error:'unlink_unavailable'},503):json({ok:true});
}
