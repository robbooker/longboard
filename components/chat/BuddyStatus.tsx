import type { PublicChatMessage } from '@/lib/publicChat';

export default function BuddyStatus({status}:{status:PublicChatMessage['buddy_status']}) {
 const text=status==='pending'||status==='processing'?'Buddy is thinking…':
  status==='failed'?"Buddy couldn't reply. Your message was sent.":
  status==='cancelled'?'Buddy response cancelled.':null;
 return text?<small role="status" data-buddy-status={status}>{text}</small>:null;
}
