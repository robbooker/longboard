import {isChatPushPreview} from '@/lib/chatPushPreview';
import {NextRequest,NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {createChatAdminClient,requestOriginAllowed} from '@/lib/chatAdmin';
import {parsePushSubscription,pushConfiguration,validPushEndpoint} from '@/lib/chatPush';
export const runtime='nodejs';export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(req:NextRequest){const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);const config=pushConfiguration();const endpoint=req.nextUrl.searchParams.get('endpoint');let subscribed=false;let preview='off';
 if(endpoint){if(!validPushEndpoint(endpoint))return json({error:'invalid_endpoint'},400);const db=createChatAdminClient();if(!db)return json({error:'push_unavailable'},503);const result=await db.from('chat_push_subscriptions').select('id,preview_mode').eq('account_id',auth.user.id).eq('endpoint',endpoint).maybeSingle();if(result.error)return json({error:'push_unavailable'},503);subscribed=!!result.data;preview=result.data?.preview_mode??'off';}
 return json({accountId:auth.user.id,configured:!!config,publicKey:config?.publicKey??null,subscribed,preview});}
async function mutate(req:NextRequest,remove:boolean){if(!requestOriginAllowed(req))return json({error:'origin_not_allowed'},403);const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);if(Number(req.headers.get('content-length'))>4096)return json({error:'invalid_subscription'},400);const body=await req.json().catch(()=>null);if(body?.accountId!==auth.user.id)return json({error:'account_changed'},409);const db=createChatAdminClient();if(!db)return json({error:'push_unavailable'},503);
 if(remove){if(!validPushEndpoint(body.endpoint))return json({error:'invalid_endpoint'},400);const result=await db.from('chat_push_subscriptions').delete().eq('account_id',auth.user.id).eq('endpoint',body.endpoint);return result.error?json({error:'push_unavailable'},503):json({ok:true});}
 if(!pushConfiguration())return json({error:'push_not_configured'},503);const subscription=parsePushSubscription(body.subscription);if(!subscription)return json({error:'invalid_subscription'},400);
 const result=await db.rpc('save_chat_push_subscription',{actor:auth.user.id,p_endpoint:subscription.endpoint,p_p256dh:subscription.keys.p256dh,p_auth:subscription.keys.auth});return result.error?json({error:result.error.message==='push_rate_limited'?'push_rate_limited':'subscription_unavailable'},result.error.message==='push_rate_limited'?429:409):json({ok:true});}
export async function POST(req:NextRequest){return mutate(req,false);}export async function DELETE(req:NextRequest){return mutate(req,true);}

export async function PATCH(req:NextRequest){
 if(!requestOriginAllowed(req))return json({error:'origin_not_allowed'},403);
 const auth=await requireChatUser(req);if(!auth.ok)return json({error:auth.error},auth.status);
 if(Number(req.headers.get('content-length'))>4096)return json({error:'invalid_preferences'},400);
 const body=await req.json().catch(()=>null);if(body?.accountId!==auth.user.id)return json({error:'account_changed'},409);
 if(!validPushEndpoint(body.endpoint)||!isChatPushPreview(body.preview))return json({error:'invalid_preferences'},400);
 const db=createChatAdminClient();if(!db)return json({error:'push_unavailable'},503);
 const result=await db.rpc('set_chat_push_preview',{actor:auth.user.id,p_endpoint:body.endpoint,p_preview:body.preview});
 return result.error?json({error:'push_unavailable'},503):result.data===true?json({ok:true,preview:body.preview}):json({error:'subscription_unavailable'},404);
}
