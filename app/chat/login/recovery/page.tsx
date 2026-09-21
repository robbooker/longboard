import Link from 'next/link';
import {requireChatUser} from '@/lib/chatAuth';
import {chatLoginRecoveryMessage} from '@/lib/chatLoginRecovery';
import ShortScoutProfileSwitch from '@/components/chat/ShortScoutProfileSwitch';
export const dynamic='force-dynamic';
export const metadata={title:'Chat sign-in help',referrer:'no-referrer'};
export default async function Recovery({searchParams}:{searchParams:Promise<{reason?:string}>}){
 const params=await searchParams;const auth=await requireChatUser();
 return <main style={{maxWidth:680,margin:'40px auto',padding:24,lineHeight:1.6}}><h1>Let’s get you back to chat</h1><p role="status">{chatLoginRecoveryMessage(params.reason)}</p><p><Link href="/chat?room=social">Return to my current chat</Link> · <Link href="/chat/login">Start sign-in again</Link></p>{auth.ok&&!auth.serverSession&&<p><a href="/api/chat/login/start?link=1&room=social">Try connecting ShortScout again</a></p>}<ShortScoutProfileSwitch accountId={auth.ok?auth.user.id:undefined}/></main>;
}
