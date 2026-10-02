'use client';
import type {RoomMessagePin} from '@/lib/chatRoomMessagePins';
import type {PublicChatMessage} from '@/lib/publicChat';
import {useChatDisplayName} from './ChatUpdates';
import styles from './RoomMessagePins.module.css';
export type MessagePinControls={canManagePins:boolean;pinnedIds:ReadonlySet<string>;busy:string|null;onToggle:(id:string,pinned:boolean)=>void};
export function MessagePinButton({message,controls}:{message:PublicChatMessage;controls?:MessagePinControls}){
 if(!controls?.canManagePins||message.pending||message.removed||message.deleted_at)return null;
 const pinned=controls.pinnedIds.has(message.id);
 return <button type='button' className={styles.control} disabled={!!controls.busy} aria-label={`${pinned?'Unpin':'Pin'} message by ${message.author_label}`} aria-pressed={pinned} onClick={()=>controls.onToggle(message.id,pinned)}>{controls.busy===message.id?'Saving…':pinned?'Unpin':'Pin'}</button>;
}
function Pin({pin,onOpen,controls}:{pin:RoomMessagePin;onOpen:(pin:RoomMessagePin)=>void;controls:MessagePinControls}){
 const author=useChatDisplayName(pin.memberId,pin.authorLabel);
 return <li data-pinned-message-id={pin.messageId}><button type='button' className={styles.open} onClick={()=>onOpen(pin)} aria-label={`Go to pinned message by ${author}: ${pin.preview}`}><strong>{author}</strong><span>{pin.preview}</span></button>{controls.canManagePins&&<button type='button' className={styles.control} disabled={!!controls.busy} aria-label={`Unpin message by ${author}`} onClick={()=>controls.onToggle(pin.messageId,true)}>Unpin</button>}</li>;
}
export default function RoomMessagePins({pins,controls,onOpen,error}:{pins:RoomMessagePin[];controls:MessagePinControls;onOpen:(pin:RoomMessagePin)=>void;error:string}){
 if(!pins.length&&!error)return null;
 return <aside className={styles.strip} aria-label='Pinned room messages'><div className={styles.heading}>Pinned messages <span>{pins.length}/10</span></div>{!!pins.length&&<ul>{pins.map(pin=><Pin key={pin.messageId} pin={pin} controls={controls} onOpen={onOpen}/>)}</ul>}{error&&<p role='alert'>{error}</p>}</aside>;
}
