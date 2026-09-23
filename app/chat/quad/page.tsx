import {redirect} from 'next/navigation';
import {requireChatUser} from '@/lib/chatAuth';
import {allowedChatRooms} from '@/lib/chatAccess';
import {loadChatBootstrap} from '@/lib/chatBootstrap';
import QuadChat from '@/components/chat/QuadChat';
export const dynamic='force-dynamic';
export const metadata={title:'Quad View · Rob Booker Chat'};
export default async function QuadPage(){
 const auth=await requireChatUser();
 if(!auth.ok){if(auth.status===401)redirect('/chat/login');return <main><h1>Chat access unavailable</h1></main>;}
 const rooms=allowedChatRooms(auth.access);
 const room=rooms[0];if(!room)redirect('/chat');
 let bootstrap;
 try{bootstrap=await loadChatBootstrap(auth,room);}catch{return <main><h1>Chat temporarily unavailable</h1><p>Please refresh to try again.</p></main>;}
 if(!bootstrap.member)redirect('/chat');
 return <QuadChat key={auth.user.id} accountId={auth.user.id} bootstrap={bootstrap} allowedRooms={rooms} serverSession={auth.serverSession} isAdmin={auth.user.role==='admin'} room={room} popout fontVariableClass="" appVersion={process.env.VERCEL_GIT_COMMIT_SHA||'development'}/>;
}
