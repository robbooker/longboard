'use client';
import MembershipBadges from './MembershipBadges';
import {memo} from 'react';
import type {ChatRoom,PublicChatMessage} from '@/lib/publicChat';
import {chatTimestamp,chatTimestampTitle} from '@/lib/chatTimestamp';
import BuddyStatus from './BuddyStatus';
import ChatMessageBody from './ChatMessageBody';
import {ChatAttachments} from './ChatAttachments';
import MessageActions from './MessageActions';
import MessageReactions from './MessageReactions';
import styles from './PublicChat.module.css';

export type RoomMessageRowProps={
 message:PublicChatMessage;room:ChatRoom;memberId?:string;guestId:string;themeReady:boolean;
 isAdmin:boolean;roomPaused:boolean;readOnlyAnnouncement:boolean;replyCount:number;replyOpen:boolean;reactionsActive:boolean;
 mentionNames:string[];
 onPrivateMessage:(memberId:string,label:string)=>void;
 onReply:(messageId:string,trigger:HTMLButtonElement)=>void;
 onEdited:(message:PublicChatMessage)=>void;
 onDeleted:(messageId:string)=>void;
};
// Counts/permissions can change independently of message text and media tokenization.
const MessageBody=memo(ChatMessageBody);
const RoomMessageRow=memo(function RoomMessageRow({message,room,memberId,guestId,themeReady,isAdmin,roomPaused,readOnlyAnnouncement,replyCount,replyOpen,reactionsActive,mentionNames,onPrivateMessage,onReply,onEdited,onDeleted}:RoomMessageRowProps){
 const own=!!memberId&&message.member_id===memberId;
 return <article className={styles.message} id={`chat-message-${message.id}`} data-own={own} data-pending={message.pending||undefined} data-bot={message.bot_slug==='buddy'||undefined}>
  <div className={styles.messageIdentity}>
   {message.member_id&&message.member_id!==memberId?
    <button type="button" className={`${styles.author} ${styles.memberAuthor}`} title={`Message ${message.author_label} privately`} onClick={()=>onPrivateMessage(message.member_id!,message.author_label)}>{message.author_label}<MembershipBadges memberships={message.bot_slug ? [] : message.memberships}/><span className={styles.memberBadge}>MESSAGE ↗</span></button>:
    <span className={styles.author}>{message.bot_slug==='buddy'?'@BUDDY':message.guest_id===guestId?'YOU':message.author_label}<MembershipBadges memberships={message.bot_slug ? [] : message.memberships}/></span>}
   <time className={styles.time} dateTime={message.created_at} title={themeReady?chatTimestampTitle(message.created_at):message.created_at}>{message.pending?'SENDING':themeReady?chatTimestamp(message.created_at):message.created_at}{message.edited_at?' · edited':''}</time>
  </div>
  <div className={styles.messageMeta}><MessageActions message={message} room={room} own={own} admin={isAdmin} paused={roomPaused} onEdited={onEdited} onDeleted={onDeleted}/></div>
  {message.reply_to_id&&<button type="button" className={styles.replyButton} onClick={event=>onReply(message.reply_to_id!,event.currentTarget)}>↳ View parent conversation</button>}
  <MessageBody body={message.body} names={mentionNames}/>
  <ChatAttachments ids={message.attachment_ids} room={room}/><BuddyStatus status={message.buddy_status}/>
  <div className={styles.messageFooter}>
   {memberId&&!message.pending&&(!readOnlyAnnouncement||!!replyCount)&&<button type="button" className={styles.replyButton} data-has-replies={replyCount>0} aria-expanded={replyOpen} onClick={event=>onReply(message.id,event.currentTarget)}>↳ {replyCount?`${replyCount} ${replyCount===1?'reply':'replies'}`:'Reply'}</button>}
   {!message.pending&&<MessageReactions active={reactionsActive} target={{kind:'room',room,messageId:message.id}} disabled={roomPaused||!memberId}/>}
  </div>
 </article>;
});
export default RoomMessageRow;
