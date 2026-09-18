import {NextRequest,NextResponse} from 'next/server';
import {processBuddyJobs} from '@/lib/chatBuddyJobs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:NextRequest) {
 const secret=process.env.CRON_SECRET;
 if(!secret||request.headers.get('authorization')!==`Bearer ${secret}`)return NextResponse.json({error:'unauthorized'},{status:401});
 try{return NextResponse.json(await processBuddyJobs(),{headers:{'Cache-Control':'no-store'}});}
 catch{return NextResponse.json({error:'buddy_worker_unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
