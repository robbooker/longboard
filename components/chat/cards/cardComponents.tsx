"use client";
// #379: how each card type in lib/chatCards.ts draws its body. The record below is typed by
// CardType, so adding a type there fails to compile until it has a component here.
// Future cards ("shortscout-stock", "chart") get their own file in this folder and a line below.
import type { ComponentType } from "react";
import dynamic from "next/dynamic";
import type { CardType } from "@/lib/chatCards";
import type { ChatRoom } from "@/lib/publicChat";
import PublicChat, { type PublicChatProps } from "../PublicChat";
import { useChatTheme } from "../room/useChatTheme";
import publicStyles from "../PublicChat.module.css";
import styles from "./cards.module.css";

// Loaded only when someone puts the table on a card, as the single chat does.
const ChatGainersTable = dynamic(() => import("../ChatGainersTable"), { ssr: false });
const ChatNewsFeed = dynamic(() => import("../ChatNewsFeed"), { ssr: false });

/** Everything a card body gets from the view around it. */
export type CardBodyProps = {
  type: CardType;
  source: string;
  /** Shown on screen right now (a phone shows one card at a time). */
  visible: boolean;
  /** The card the member last touched. Chat cards mark messages read only while active. */
  active: boolean;
  /** The page's own chat props (bootstrap, account, version). */
  chat: PublicChatProps;
  /** Rooms the member can open, for links inside chat cards. */
  allowedRooms: ChatRoom[];
  /** Chat cards hand the header their "skip to latest" action here. */
  onSkipLatest: (handler: (() => void) | null) => void;
  /** A name in a chat card was asked to message privately. */
  onPrivateMessage: (otherId: string) => void;
};

export type CardComponent = {
  Body: ComponentType<CardBodyProps>;
  /** The header shows "skip to latest" (chat cards only). */
  skipLatest?: boolean;
};

/** A room or a DM: the same PublicChat pane Quad shows. */
function ChatCardBody({ type, source, visible, active, chat, allowedRooms, onSkipLatest, onPrivateMessage }: CardBodyProps) {
  const room = type === "room" ? (source as ChatRoom) : chat.room;
  return (
    <PublicChat
      {...chat}
      allowedRooms={allowedRooms}
      room={room}
      bootstrap={{
        ...chat.bootstrap!,
        room,
        // The server-rendered landing spot belongs to the page's room only.
        opening: type === "room" && room === chat.bootstrap?.room ? chat.bootstrap?.opening : undefined,
        messages: [],
        reactions: [],
        counts: {},
      }}
      pane={{
        visible,
        active,
        onSkipLatest,
        conversationId: type === "dm" ? source : undefined,
        onPrivateMessage,
      }}
    />
  );
}

/**
 * The Gainers Table through its own public component, untouched: it reads and refreshes itself.
 * The chat theme's colours come from the chat page class; the card only makes it smaller.
 */
function GainersTableCardBody() {
  const { theme } = useChatTheme();
  return (
    <div className={`${publicStyles.page} ${styles.gainers}`} data-theme={theme} data-card-gainers>
      <ChatGainersTable />
    </div>
  );
}

/** #383: the News Feed page, compact; it scrolls inside the card and keeps its place on refresh. */
function NewsCardBody() {
  const { theme } = useChatTheme();
  return (
    <div className={`${publicStyles.page} ${styles.news}`} data-theme={theme} data-card-news>
      <ChatNewsFeed compact />
    </div>
  );
}

export const CARD_COMPONENTS: Record<CardType, CardComponent> = {
  room: { Body: ChatCardBody, skipLatest: true },
  dm: { Body: ChatCardBody, skipLatest: true },
  "gainers-table": { Body: GainersTableCardBody },
  news: { Body: NewsCardBody },
};
