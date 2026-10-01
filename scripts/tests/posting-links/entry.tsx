import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import PublicChat from '../../../components/chat/PublicChat';
import DirectInbox from '../../../components/chat/DirectInbox';
import ChatReplyPanel, { type ReplyDraft } from '../../../components/chat/ChatReplyPanel';
import MessageActions from '../../../components/chat/MessageActions';
import DirectMessageActions from '../../../components/chat/DirectMessageActions';
import type { ChatMember, DirectMessage } from '../../../lib/chatDirectMessages';
import type { ChatRoom, PublicChatMessage } from '../../../lib/publicChat';
import styles from '../../../components/chat/PublicChat.module.css';

declare global { interface Window { fixture: { mode: string; room: ChatRoom; member: ChatMember; message: PublicChatMessage; direct: DirectMessage; conversation: string } } }
const data = window.fixture;
function Fixture() {
  const [sidebar, setSidebar] = useState<HTMLDivElement | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [draft] = useState<ReplyDraft>({ body: '', scroll: 0 });
  const [message, setMessage] = useState(data.message);
  const [direct, setDirect] = useState(data.direct);
  if (data.mode.includes('room') && !data.mode.includes('edit')) return <div style={data.mode === 'quad-room' ? { width: 'min(680px, 100vw)', height: 480 } : undefined}><PublicChat
    isAdmin accountId="account" serverSession room={data.room} popout={false} fontVariableClass=""
    pane={data.mode === 'quad-room' ? { visible: true } : undefined}
    allowedRooms={data.room === 'main' ? ['main', 'social'] : [data.room]} bootstrap={{ accountId: 'account', room: data.room, member: data.member, roomState: { isOpen: true, pausedAt: null, notice: null, updatedAt: '' }, messages: [message], reactions: [], counts: {}, featureChannel: false }} /></div>;
  return <main className={styles.page} data-theme="dark" style={{ minHeight: '100vh', maxWidth: data.mode === 'quad-dm' ? 680 : undefined, padding: 16, boxSizing: 'border-box' }}>
    {data.mode === 'reply' ? <ChatReplyPanel messageId={message.id} memberId={data.member.id} room={data.room} paused={false} depth={1} draft={draft} onBack={() => {}} onOpen={() => {}} onClose={() => {}} onSent={setMessage} />
      : data.mode === 'room-edit' ? <MessageActions message={message} room={data.room} own admin={false} paused={false} onEdited={setMessage} onDeleted={() => {}} />
      : data.mode === 'dm-edit' ? <DirectMessageActions message={direct} conversationId={data.conversation} canEdit onChanged={setDirect} />
      : <><div ref={setSidebar} /><div ref={setHost} style={{ height: 650, display: 'flex', minHeight: 0 }} /><DirectInbox member={data.member} target={data.mode === 'request' ? { id: '10000000-0000-4000-8000-000000000003', name: 'Carol' } : null} controlledConversation={data.mode === 'quad-dm' ? data.conversation : undefined} onTargetClosed={() => {}} sidebarHost={sidebar} conversationHost={host} /></>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
