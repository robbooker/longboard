"use client";
import { Fragment, useState, type ReactNode } from "react";
import { tokenizeChatMessage, tradingViewSnapshotFromText, type TradingViewSnapshot } from "@/lib/publicChat";
import { renderMentions, useMentionMembers } from "./MemberMention";
import { chatGifFromText, chatGifFromUrl } from "@/lib/chatGifs";
import { ChatGif } from "./ChatGif";
import MessageFold from "./MessageFold";
import { runnerWatchPostLink } from "@/lib/chatRunnerWatchText";
import { AI_INSIGHTS_BOT, aiInsightsNoteLink, aiInsightsSpans } from "@/lib/chatAiInsightsText";
import { CHAT_STAGE_OPEN_EVENT, STAGE_NOTICE_BOT, stageLiveNotice } from "@/lib/chatStageNotice";
import styles from "./PublicChat.module.css";

function TradingViewPreview({ snapshot }: { snapshot: TradingViewSnapshot }) {
  const [state, setState] = useState<"loading" | "error" | "success">("loading");
  return (
    <a
      className={styles.preview}
      href={snapshot.href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open TradingView chart ${snapshot.chartId} in a new tab`}
    >
      <span className={styles.previewFrame}>
        {/* TradingView chart-share snapshots are public images. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={styles.previewImage}
          src={snapshot.imageUrl}
          alt="TradingView chart shared in Longboard Chat"
          width="1200"
          height="675"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setState("success")}
          onError={() => setState("error")}
        />
        {state !== "success" ? (
          <span className={styles.previewNotice}>
            {state === "loading" ? "LOADING CHART…" : "PREVIEW UNAVAILABLE · OPEN ↗"}
          </span>
        ) : null}
      </span>
      <span className={styles.previewMeta}>
        <span>TRADINGVIEW CHART</span>
        <span>OPEN ↗</span>
      </span>
    </a>
  );
}

/**
 * D-366: message words with web addresses drawn as safe links (new tab) and member tags drawn
 * by `renderMentions`. Every chat surface (room, thread replies, DMs) uses this, so links look
 * and behave the same everywhere, including on messages sent before links were detected.
 */
export function LinkedText({
  text,
  highlight = [],
  linkLabel,
  messageId,
}: {
  text: string;
  highlight?: string[];
  linkLabel?: (href: string) => string | null;
  /** #439: a room message's id, so its stored tags (the person, not the name) are used. */
  messageId?: string;
}) {
  const members = useMentionMembers(text, messageId);
  return (
    <>
      {tokenizeChatMessage(text).map((part, index) =>
        part.kind === "link" ? (
          <a
            className={styles.bodyLink}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            key={`${part.href}-${index}`}
          >
            {linkLabel?.(part.href) ?? part.value}
          </a>
        ) : (
          <span key={`text-${index}`}>{renderMentions(part.value, members, highlight)}</span>
        ),
      )}
    </>
  );
}

/** #482: the AI's words with their **bold** and *italic*; links and tags as everywhere else. */
export function AiInsightsText({ text, messageId }: { text: string; messageId?: string }) {
  return (
    <>
      {text.split("\n").map((line, row) => (
        <Fragment key={row}>
          {row > 0 && "\n"}
          {aiInsightsSpans(line).map((span, index) =>
            span.kind === "strong" ? (
              <strong key={index}>
                <LinkedText text={span.value} messageId={messageId} />
              </strong>
            ) : span.kind === "em" ? (
              <em key={index}>
                <LinkedText text={span.value} messageId={messageId} />
              </em>
            ) : (
              <LinkedText key={index} text={span.value} messageId={messageId} />
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}

export default function ChatMessageBody({
  body,
  names = [],
  plain = false,
  botSlug,
  lead,
  messageId,
}: {
  body: string;
  /** #439: a room message's id (its tags are stored with the person they point to). */
  messageId?: string;
  names?: string[];
  plain?: boolean;
  botSlug?: string | null;
  /** #419: a small floated note inside the text's paragraph (a Gainers alert's time and date). */
  lead?: ReactNode;
}) {
  const snapshot = tradingViewSnapshotFromText(body);
  const gif = chatGifFromText(body);
  // #419: the note goes at the end of the first line. Floated there, it sits beside that line when
  // there is room and beside the next line when there is not, so the first line is never squeezed.
  const firstLineEnd = lead ? body.indexOf("\n") : -1;
  const linkLabel = gif
    ? (href: string) => (chatGifFromUrl(href)?.id === gif.id ? "GIF ↗" : null)
    : undefined;
  // #352: words a member sent through a form: no links, tags, charts or GIFs.
  if (plain)
    return (
      <div className={styles.bodyBlock}>
        <MessageFold body={body} className={styles.body}>
          {lead}
          {body}
        </MessageFold>
      </div>
    );
  // #341: only the Runner Risk Watch bot's own link gets a label. It stays in the app, where the member is signed in.
  const report = botSlug === "runner-watch" ? runnerWatchPostLink(body) : null;
  if (report)
    return (
      <div className={styles.bodyBlock}>
        <p className={styles.body}>
          {lead}
          {report.before}
          <a className={styles.bodyLink} href={report.href}>
            {report.label}
          </a>
          {report.after}
        </p>
      </div>
    );
  // #482: the AI's note in SS links to the day's write-up inside the app.
  const aiNote = botSlug === AI_INSIGHTS_BOT ? aiInsightsNoteLink(body) : null;
  if (aiNote)
    return (
      <div className={styles.bodyBlock}>
        <p className={styles.body}>
          {lead}
          {aiNote.before}
          <a className={styles.bodyLink} href={aiNote.href}>
            {aiNote.label}
          </a>
          {aiNote.after}
        </p>
      </div>
    );
  // #503: the room's "live now" notice. "Watch live" opens the stage: in place when the room on
  // screen can (it cancels the event), otherwise by the stage link. A phone has the same button
  // (#509): it opens the phone's viewing room.
  const live = botSlug === STAGE_NOTICE_BOT ? stageLiveNotice(body) : null;
  if (live)
    return (
      <div className={styles.bodyBlock}>
        <p className={styles.body} data-stage-notice>
          {lead}
          {live.before}
          <a
            className={styles.stageWatch}
            href={live.href}
            data-stage-notice-watch
            onClick={(event) => {
              const ask = new CustomEvent(CHAT_STAGE_OPEN_EVENT, { cancelable: true, detail: { room: live.room } });
              if (!window.dispatchEvent(ask)) event.preventDefault();
            }}
          >
            {live.label}
          </a>
        </p>
      </div>
    );
  // #482: the AI's write-ups and answers show **bold** and *italic*; nothing else is formatted.
  if (botSlug === AI_INSIGHTS_BOT)
    return (
      <div className={styles.bodyBlock}>
        <MessageFold body={body} className={styles.body}>
          {lead}
          <AiInsightsText text={body} messageId={messageId} />
        </MessageFold>
      </div>
    );
  return (
    <div className={styles.bodyBlock}>
      <MessageFold body={body} className={styles.body}>
        {/* #317: tags of real members become links; `names` (Buddy) keep the plain highlight. */}
        {firstLineEnd < 0 ? (
          <>
            {lead}
            <LinkedText text={body} highlight={names} linkLabel={linkLabel} messageId={messageId} />
          </>
        ) : (
          <>
            <LinkedText
              text={body.slice(0, firstLineEnd)}
              highlight={names}
              linkLabel={linkLabel}
              messageId={messageId}
            />
            {lead}
            <LinkedText
              text={body.slice(firstLineEnd)}
              highlight={names}
              linkLabel={linkLabel}
              messageId={messageId}
            />
          </>
        )}
      </MessageFold>
      {snapshot ? <TradingViewPreview key={snapshot.chartId} snapshot={snapshot} /> : null}
      {gif ? <ChatGif key={gif.id} gif={gif} /> : null}
    </div>
  );
}
