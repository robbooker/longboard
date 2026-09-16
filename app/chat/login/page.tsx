import Link from "next/link";
export default async function ChatLogin({searchParams}:{searchParams:Promise<{room?:string;popout?:string}>}) {
 const params=await searchParams;
 const room=["main","social","shortscout"].includes(params.room??"")?params.room!:"main";
 const query=`room=${room}${params.popout==="1"?"&popout=1":""}`;
 return <main style={{maxWidth:460,margin:"12vh auto",padding:28}}>
  <h1>Sign in to chat</h1><p>Choose your membership. Longboard includes LB and SOCIAL. Paid ShortScout members can join SS and SOCIAL.</p>
  <p><Link href={`/login?next=${encodeURIComponent(`/chat?${query}`)}`}>Sign in with Longboard →</Link></p>
  <p><a href={`/api/chat/login/start?${query}`}>Sign in with ShortScout →</a></p>
  <p>Have both? Sign in with Longboard, then connect ShortScout from the chat menu.</p>
 </main>;
}
