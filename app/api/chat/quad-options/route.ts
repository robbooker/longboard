import {NextRequest,NextResponse} from 'next/server';
import {requireChatUser} from '@/lib/chatAuth';
import {allowedChatRooms} from '@/lib/chatAccess';
import {readInbox} from '@/lib/chatReads/inbox';
export const dynamic='force-dynamic';
export async function GET(){
 const auth=await requireChatUser();
 if(!auth.ok)return NextResponse.json({error:auth.error},{status:auth.status});
 const response=await readInbox(new NextRequest('https://chat.internal/api/chat/inbox'),auth);
 if(!response.ok)return response;
 const inbox=await response.json();
 return NextResponse.json({accountId:auth.user.id,rooms:allowedChatRooms(auth.access),conversations:inbox.conversations},{headers:{'Cache-Control':'private, no-store'}});
}
