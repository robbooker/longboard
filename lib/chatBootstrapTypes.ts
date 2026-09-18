import type { ChatMember } from '@/lib/chatDirectMessages';
import type { ChatRoom, PublicChatMessage, PublicChatReaction, PublicChatRoomState } from '@/lib/publicChat';
export type ChatBootstrap = {
  accountId:string; room:ChatRoom; member:ChatMember|null; roomState:PublicChatRoomState;
  messages:PublicChatMessage[]; reactions:PublicChatReaction[]; counts:Record<string,number>;
  featureChannel:boolean;
};
