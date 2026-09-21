import {NextRequest,NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {createChatAdminClient,requestOriginAllowed} from '@/lib/chatAdmin';
import {CHAT_LOGIN_COOKIE,SHORTSCOUT_SITE,chatCookieOptions} from '@/lib/chatLoginConfig';
import {newChatLoginSecret,chatSecretHash,chatLoginChallenge} from '@/lib/chatLoginProof';
export async function POST(req:NextRequest){
 const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
 if(!requestOriginAllowed(req))return json({error:'origin_not_allowed'},403);
 const auth=await requireChatUser();if(!auth.ok)return json({error:'Sign in again before switching profiles.'},401);
 const db=createChatAdminClient();if(!db)return json({error:'Profile switch is unavailable.'},503);
 // Resolve only the verified actor; never accept a requested source/account ID.
 const [bridge,direct]=await Promise.all([
  db.from('chat_shortscout_membership_links').select('subject').eq('lb_account_id',auth.user.id).maybeSingle(),
  db.from('chat_provider_identities').select('subject').eq('account_id',auth.user.id).eq('provider','shortscout').maybeSingle(),
 ]);
 if(bridge.error||direct.error)return json({error:'Profile switch is unavailable.'},503);
 const expectedSubject=bridge.data?.subject??direct.data?.subject??null;
 const state=newChatLoginSecret(),verifier=newChatLoginSecret();
 const pending=await db.from('chat_login_requests').insert({state_hash:chatSecretHash(state),challenge:chatLoginChallenge(verifier),link_user_id:null,return_room:'social',expected_subject:expectedSubject});
 if(pending.error)return json({error:'Could not prepare the profile switch.'},503);
 const target=new URL('/chat-connect',SHORTSCOUT_SITE);target.searchParams.set('state',state);
 if(req.nextUrl.origin==='https://chat.robbooker.com')target.searchParams.set('chat_origin','https://chat.robbooker.com');
 const response=json({redirectUrl:target.href});response.cookies.set(CHAT_LOGIN_COOKIE,`${state}.${verifier}`,{...chatCookieOptions,maxAge:300});return response;
}
