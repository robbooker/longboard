"use client";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { handleChatKeyDown } from "@/lib/chatKeyboard";
import type { ChatRoom, PublicChatMessage } from "@/lib/publicChat";
import { useRef, useState, type Dispatch, type FormEvent, type RefObject, type SetStateAction } from "react";
import { AttachmentPicker } from "../ChatAttachments";
import composerStyles from "../ChatComposer.module.css";
import { GifComposer } from "../ChatGif";
import { ChatPollComposer } from "../ChatPoll";
import ChatIcon from "../ChatIcon";
import ComposerLinkPreview from "../ComposerLinkPreview";
import ComposerSend from "../ComposerSend";
import type { useAttachments } from "../hooks/useAttachments";
import MentionTextarea from "../MentionTextarea";
import styles from "../PublicChat.module.css";
import VoiceRecorder from "../VoiceRecorder";
import type { ActionState } from "./types";
import { chatTypingRoomChannel } from "@/lib/chatTyping";
import TypingIndicator from "../TypingIndicator";
import { roomMemberName, useTypingSender } from "./useTyping";

export const MAX_MESSAGE_LENGTH = 600;

export type RoomComposerProps = {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  uploads: ReturnType<typeof useAttachments>;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  body: string;
  setBody: Dispatch<SetStateAction<string>>;
  hasDraft: boolean;
  sendState: ActionState;
  setSendState: Dispatch<SetStateAction<ActionState>>;
  error: string;
  setError: Dispatch<SetStateAction<string>>;
  feedback: string;
  messages: PublicChatMessage[];
  member: ChatMember | null;
  displayName: string;
  room: ChatRoom;
  roomLabel: string;
  /** Rendered inside a quad pane. */
  pane: boolean;
  recordings: boolean;
  announcement: boolean;
};

/** The room composer: attachments, GIFs, mentions, send, voice and the hint/privacy line. */
export default function RoomComposer({
  onSubmit,
  uploads,
  composerRef,
  body,
  setBody,
  hasDraft,
  sendState,
  setSendState,
  error,
  setError,
  feedback,
  messages,
  member,
  displayName,
  room,
  roomLabel,
  pane,
  recordings,
  announcement,
}: RoomComposerProps) {
  const aboutRef = useRef<HTMLDetailsElement>(null);
  const voiceStart = useRef<(() => void) | null>(null);
  const typingChannel = member ? chatTypingRoomChannel(room) : null;
  const onTyping = useTypingSender(typingChannel);
  const [pollOpen, setPollOpen] = useState(false);
  return (
    <>
    <form className={styles.composerWrap} onSubmit={onSubmit} onInput={onTyping}>
      <TypingIndicator
        channel={typingChannel}
        selfId={member?.id}
        room={room}
        resolveName={(id) => roomMemberName(room, id)}
      />
      <AttachmentPicker uploads={uploads} disabled={sendState === "loading"} />
      <div className={composerStyles.bar}>
        <GifComposer
          buttonClassName={composerStyles.add}
          onAttach={() => uploads.input.current?.click()}
          disabled={sendState === "loading"}
          extras={[
            // The mic gives way to the send arrow while there is a draft; recording stays one tap away here.
            ...(hasDraft
              ? [
                  {
                    key: "voice",
                    label: (
                      <>
                        <ChatIcon name="mic" /> Voice message
                      </>
                    ),
                    onSelect: () => voiceStart.current?.(),
                  },
                ]
              : []),
            // #328: a poll in this room.
            ...(member ? [{ key: "poll", label: "📊 Poll", onSelect: () => setPollOpen(true) }] : []),
            ...(!pane && !recordings && !announcement
              ? [
                  {
                    key: "privacy",
                    label: "About privacy",
                    onSelect: () => aboutRef.current?.setAttribute("open", ""),
                  },
                ]
              : []),
          ]}
          onAdd={(url) => {
            const next = [body.trim(), url].filter(Boolean).join("\n");
            if (next.length > MAX_MESSAGE_LENGTH) return false;
            setBody(next);
            setError("");
            return true;
          }}
        />
        <div className={composerStyles.field}>
          <MentionTextarea
            inputRef={composerRef}
            data-chat-composer
            onPaste={uploads.paste}
            enabled={Boolean(member)}
            buddyEnabled={room === "main"}
            className={composerStyles.input}
            value={body}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={1}
            aria-label={`Message ${roomLabel}`}
            aria-describedby={pane ? `feedback-${room}` : "longboard-chat-feedback"}
            aria-invalid={sendState === "error"}
            onKeyDown={(event) => {
              // ↑ in an empty box edits your last message, like Slack (QUICK-SWITCH).
              if (event.key === "ArrowUp" && !body && !event.shiftKey && !event.nativeEvent.isComposing) {
                const last = [...messages]
                  .reverse()
                  .find(
                    (message) =>
                      !!member &&
                      message.member_id === member.id &&
                      !message.bot_slug &&
                      !message.pending &&
                      !message.deleted_at &&
                      !message.removed,
                  );
                if (last) {
                  event.preventDefault();
                  window.dispatchEvent(new CustomEvent("chat-edit-message", { detail: last.id }));
                  return;
                }
              }
              handleChatKeyDown(event);
            }}
            placeholder={`Write as ${displayName}…`}
            onValue={(value) => {
              setBody(value);
              setError("");
              if (sendState === "error") setSendState("default");
            }}
          />
          <ComposerSend
            label="Send"
            hidden={!hasDraft}
            disabled={sendState === "loading" || uploads.blocked}
            state={sendState}
          />
          <VoiceRecorder
            key={room}
            uploads={uploads}
            disabled={sendState === "loading"}
            micClassName={composerStyles.mic}
            hideMic={hasDraft}
            startRef={voiceStart}
          />
        </div>
      </div>
      <ComposerLinkPreview body={body} />
      <div className={styles.composerHint} data-has-feedback={Boolean(feedback)}>
        <p
          id={pane ? `feedback-${room}` : "longboard-chat-feedback"}
          className={styles.feedback}
          data-error={Boolean(error)}
          aria-live="polite"
        >
          {feedback}
          {!pane && (
            <>
              <span className={styles.enterHint}>{feedback ? " · " : ""}Enter to send · </span>
              {recordings
                ? "Recordings alert members · Replies are off"
                : room === "whats-new"
                  ? "Shows as unread · No alerts · Replies are off"
                  : announcement
                  ? "Announcements alert members"
                  : "/summary for a private recap"}
            </>
          )}
        </p>
        {!pane && !recordings && !announcement && (
          <details ref={aboutRef} className={styles.composerAbout}>
            <summary>
              <u>About privacy</u>
            </summary>
            <p>
              {room === "shortscout"
                ? "Messages are saved and visible to verified ShortScout members and chat admins."
                : "Messages are saved, searchable by members, and may be processed for AI search and private summaries."}{" "}
              Type /summary for a private recap of this room.
              {room === "main" ? " Buddy replies only to @Buddy." : ""}
            </p>
          </details>
        )}
      </div>
    </form>
    {/* #328: outside the composer form (a form can't hold another). */}
    {/* Mounted only while open, so its controls never count among the page's own. */}
    {member && pollOpen && <ChatPollComposer room={room} open onClose={() => setPollOpen(false)} />}
    </>
  );
}
