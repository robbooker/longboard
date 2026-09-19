import {NextRequest,NextResponse} from 'next/server';import {processChatPushJobs} from '@/lib/chatPush';
export const runtime='nodejs';export const dynamic='force-dynamic';export const maxDuration=60;
export async function GET(req:NextRequest){const secret=process.env.CRON_SECRET;if(!secret||req.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'unauthorized'},{status:401});try{return NextResponse.json(await processChatPushJobs(),{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'push_unavailable'},{status:503});}}
