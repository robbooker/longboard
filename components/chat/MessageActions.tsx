"use client";
import {useId,useRef,useState} from "react";
import type {ChatRoom,PublicChatMessage} from "@/lib/publicChat";
import styles from "./MessageActions.module.css";
export default function MessageActions({message,room,own,admin,paused,editOnly=false,onEdited,onDeleted}:{message:PublicChatMessage;room:ChatRoom;own:boolean;admin:boolean;paused:boolean;editOnly?:boolean;onEdited:(message:PublicChatMessage)=>void;onDeleted:(id:string)=>void}) {
 const instanceId=useId();
 const dialog=useRef<HTMLDialogElement>(null);
 const [action,setAction]=useState<"edit"|"delete">("edit");
 const [body,setBody]=useState("");
 const [original,setOriginal]=useState("");
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 if(message.pending||(!own&&!admin)||(editOnly&&(!own||!!message.bot_slug))) return null;
 function open(next:"edit"|"delete") {setAction(next);setBody(message.body);setOriginal(message.body);setError("");dialog.current?.showModal();}
 async function submit() {
  if(busy) return;
  setBusy(true);setError("");
  try {
   const response=await fetch("/api/chat/message",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,room,messageId:message.id,body,expectedBody:original})});
   const result=await response.json();
   if(!response.ok) throw new Error(result.error==="message_changed"?"This message changed in another window. Close this editor and try again.":result.error==="message_not_found"?"This message was already removed.":result.error==="chat_paused"?"Editing is paused in this room.":"Could not update this message. Please try again.");
   if(action==="edit") onEdited(result.message);else onDeleted(message.id);
   dialog.current?.close();
  }catch(e){setError(e instanceof Error?e.message:"Could not update message.");}finally{setBusy(false);}
 }
 return <>
  <details className={styles.actions}><summary aria-label={`Actions for message by ${message.author_label}`}>•••</summary><div>
   {own&&!message.bot_slug&&<button type="button" disabled={paused} onClick={()=>open("edit")}>Edit</button>}
   {!editOnly&&<button type="button" onClick={()=>open("delete")}>{own?"Delete":"Delete as admin"}</button>}
  </div></details>
  <dialog ref={dialog} aria-labelledby={`message-action-title-${instanceId}`} className={styles.dialog} onCancel={event=>{if(busy)event.preventDefault();}}>
   <form onSubmit={event=>{event.preventDefault();void submit();}}>
    <h2 id={`message-action-title-${instanceId}`}>{action==="edit"?"Edit message":"Delete message?"}</h2>
    {action==="edit"?<><label htmlFor={`edit-${instanceId}`}>Message</label><textarea id={`edit-${instanceId}`} value={body} onChange={event=>setBody(event.target.value)} maxLength={600} rows={5} autoFocus onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void submit();}}}/><small>Enter to save · Shift+Enter for a new line</small></>:<><p>This removes the message from the room and search. This cannot be undone.</p><blockquote>{message.body}</blockquote></>}
    {error&&<p role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={()=>dialog.current?.close()}>Cancel</button><button disabled={busy||(action==="edit"&&!body.trim())}>{busy?"Working…":action==="edit"?"Save changes":"Delete message"}</button></footer>
   </form>
  </dialog>
 </>;
}
