import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import DirectInbox from '../../../components/chat/DirectInbox';
import PublicChat from '../../../components/chat/PublicChat';
const member={id:'10000000-0000-4000-8000-000000000001',display_name:'Alice',accepts_requests:true};
const data=(window as any).fixture;
function Dm(){const [target,setTarget]=useState<{id:string;name:string}|null>(null);const [sidebar,setSidebar]=useState<HTMLDivElement|null>(null),[host,setHost]=useState<HTMLDivElement|null>(null);return <><button onClick={()=>setTarget({id:"10000000-0000-4000-8000-000000000003",name:"Carol"})}>New request</button><div ref={setSidebar}/><div style={{height:700,display:"flex",minHeight:0}} ref={setHost}/><DirectInbox member={member as any} target={target} onTargetClosed={()=>setTarget(null)} sidebarHost={sidebar} conversationHost={host}/></>}
createRoot(document.getElementById('root')!).render(data.mode==='dm'?<Dm/>:<PublicChat accountId="account" serverSession room="main" popout={false} fontVariableClass="" allowedRooms={['main','social']} bootstrap={{accountId:'account',room:'main',member,roomState:{isOpen:true},messages:data.roomMessages,reactions:[],counts:{},featureChannel:false} as any}/>);
