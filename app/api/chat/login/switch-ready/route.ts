import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {requestOriginAllowed} from '@/lib/chatAdmin';
export async function POST(req:NextRequest){
 const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
 if(!requestOriginAllowed(req))return json({error:'origin_not_allowed'},403);
 try {
  // Prove the LB browser session is absent, rather than interpreting an auth
  // provider/network failure (or missing profile) as successful logout.
  const client=await createClient();const {data,error}=await client.auth.getSession();
  if(error)return json({error:'Could not confirm Longboard sign-out. Please try again.'},503);
  return data.session?json({error:'Longboard is still signed in on this browser. Please try again.'},409):json({ok:true});
 }catch{return json({error:'Could not confirm Longboard sign-out. Please try again.'},503);}
}
