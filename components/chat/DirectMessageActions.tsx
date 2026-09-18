"use client";
import {useRef,useState} from "react";
import type {DirectMessage} from "@/lib/chatDirectMessages";
import styles from "./MessageActions.module.css";

export default function DirectMessageActions({message,conversationId,canEdit,onChanged}:{message:DirectMessage;conversationId:string;canEdit:boolean;onChanged:(message:DirectMessage)=>void}) {
 const dialog=useRef<HTMLDialogElement>(null),menu=useRef<HTMLDetailsElement>(null),trigger=useRef<HTMLElement>(null);
 const [action,setAction]=useState<"edit"|"delete">("edit"),[body,setBody]=useState(""),[revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState("");
 function open(next:"edit"|"delete") {setAction(next);setBody(message.body);setRevision(message.revision??0);setError("");if(menu.current)menu.current.open=false;dialog.current?.showModal();}
 async function submit() {
  if(busy||(action==="edit"&&!body.trim()))return;
  setBusy(true);setError("");
  try {
   const response=await fetch("/api/chat/inbox",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,target:conversationId,messageId:message.id,expectedRevision:revision,body})});
   const result=await response.json();if(!response.ok)throw new Error(result.error||"Could not update this message. Please try again.");
   onChanged(result.message);dialog.current?.close();
  }catch(e){setError(e instanceof Error?e.message:"Could not update this message.");}finally{setBusy(false);}
 }
 return <>
  <details ref={menu} className={styles.actions}><summary ref={trigger} aria-label="Actions for your private message">•••</summary><div>
   <button type="button" disabled={!canEdit} onClick={()=>open("edit")}>Edit</button>
   <button type="button" onClick={()=>open("delete")}>Delete</button>
  </div></details>
  <dialog ref={dialog} aria-labelledby={`dm-action-title-${message.id}`} className={styles.dialog} onKeyDown={event=>event.stopPropagation()} onCancel={event=>{if(busy)event.preventDefault();}} onClose={()=>trigger.current?.focus({preventScroll:true})}>
   <form onSubmit={event=>{event.preventDefault();void submit();}}>
    <h2 id={`dm-action-title-${message.id}`}>{action==="edit"?"Edit message":"Delete message?"}</h2>
    {action==="edit"?<><label htmlFor={`dm-edit-${message.id}`}>Message</label><textarea id={`dm-edit-${message.id}`} value={body} onChange={event=>setBody(event.target.value)} maxLength={2000} rows={5} autoFocus disabled={busy} onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void submit();}}}/><small>Enter to save · Shift+Enter for a new line</small></>:<><p>This replaces the message with “Message deleted” for both people. This cannot be undone.</p><blockquote>{message.body}</blockquote></>}
    {error&&<p role="alert">{error}</p>}
    <footer><button type="button" disabled={busy} onClick={()=>dialog.current?.close()}>Cancel</button><button disabled={busy||(action==="edit"&&!body.trim())}>{busy?"Working…":action==="edit"?"Save changes":"Delete message"}</button></footer>
   </form>
  </dialog>
 </>;
}
