'use client';
import {useState} from 'react';
import {createClient} from '@/lib/supabase/client';
import {disableCurrentChatPush} from '@/lib/chatPushBrowser';
import {clearChatDrafts} from '@/lib/chatRefreshDrafts';
import {switchToShortScoutProfile} from '@/lib/chatProfileSwitch';
export default function ShortScoutProfileSwitch({accountId,canDisconnect=false}:{accountId?:string;canDisconnect?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 async function openOriginal(){
  setBusy(true);setError('');
  try{
   let destination='/api/chat/login/start?room=social';
   if(accountId){const prepared=await fetch('/api/chat/login/switch',{method:'POST'});const result=await prepared.json();if(!prepared.ok||typeof result.redirectUrl!=='string')throw Error('Could not prepare the original profile sign-in. Please try again.');destination=result.redirectUrl;}
   await switchToShortScoutProfile({
   disablePush:async()=>{if(accountId)await disableCurrentChatPush(accountId);},
   logoutChat:async()=>{if(!(await fetch('/api/chat/login/logout',{method:'POST'})).ok)throw Error('Could not sign out of this chat profile. Please try again.');},
   logoutLongboard:async()=>{const client=createClient();const result=await client.auth.signOut({scope:'local'});if(result.error)throw Error('Could not sign out of Longboard on this browser. Please try again.');const check=await client.auth.getSession();if(check.error||check.data.session)throw Error('Longboard is still signed in. Please try again.');if(!(await fetch('/api/chat/login/switch-ready',{method:'POST'})).ok)throw Error('Longboard is still signed in on this browser. Please try again.');},
   clear:()=>{try{clearChatDrafts(sessionStorage);localStorage.removeItem('longboard-public-chat-guest-token-v1');localStorage.removeItem('longboard-public-chat-display-name-v1');}catch{}},
   navigate:()=>window.location.replace(destination),
  });}catch(e){setError(e instanceof Error?e.message:'Could not switch profiles. Please try again.');setBusy(false);}
 }
 async function disconnect(){setBusy(true);setError('');try{const response=await fetch('/api/chat/login/unlink',{method:'POST'});if(!response.ok)throw Error('Could not disconnect this membership. Please try again.');window.location.replace('/chat?room=social');}catch(e){setError(e instanceof Error?e.message:'Please try again.');setBusy(false);}}
 return <section aria-label="Original ShortScout profile"><h2>Your original ShortScout profile</h2><p>Your earlier ShortScout messages and inbox remain in that profile. Opening it signs out of Longboard and this chat profile on this browser, {accountId ? "turns off this device’s current chat notifications, then asks ShortScout" : "then asks ShortScout"} to verify your sign-in. Other devices stay signed in. Unsaved chat drafts on this browser are cleared.</p><button type="button" onClick={()=>void openOriginal()} disabled={busy}>{busy?'Please wait…':'Open original ShortScout profile'}</button>{canDisconnect&&<><p>Disconnecting removes ShortScout access from this Longboard chat profile. It keeps both profiles and their messages.</p><button type="button" onClick={()=>void disconnect()} disabled={busy}>Disconnect ShortScout membership</button></>}{error&&<p role="alert">{error}</p>}</section>;
}
