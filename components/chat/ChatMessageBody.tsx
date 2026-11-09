"use client";
import { useState } from "react";
import { tokenizeChatMessage, tradingViewSnapshotFromText, type TradingViewSnapshot } from "@/lib/publicChat";
import { renderMentions, useMentionMembers } from "./MemberMention";
import { chatGifFromText, chatGifFromUrl } from "@/lib/chatGifs";
import { ChatGif } from "./ChatGif";
import MessageFold from "./MessageFold";
import { runnerWatchPostLink } from "@/lib/chatRunnerWatchText";
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
}: {
  text: string;
  highlight?: string[];
  linkLabel?: (href: string) => string | null;
}) {
  const members = useMentionMembers(text);
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

export default function ChatMessageBody({
  body,
  names = [],
  plain = false,
  botSlug,
}: {
  body: string;
  names?: string[];
  plain?: boolean;
  botSlug?: string | null;
}) {
  const snapshot = tradingViewSnapshotFromText(body);
  const gif = chatGifFromText(body);
  // #352: words a member sent through a form: no links, tags, charts or GIFs.
  if (plain)
    return (
      <div className={styles.bodyBlock}>
        <MessageFold body={body} className={styles.body}>{body}</MessageFold>
      </div>
    );
  // #341: only the Runner Risk Watch bot's own link gets a label. It stays in the app, where the member is signed in.
  const report = botSlug === "runner-watch" ? runnerWatchPostLink(body) : null;
  if (report)
    return (
      <div className={styles.bodyBlock}>
        <p className={styles.body}>
          {report.before}
          <a className={styles.bodyLink} href={report.href}>
            {report.label}
          </a>
          {report.after}
        </p>
      </div>
    );
  return (
    <div className={styles.bodyBlock}>
      <MessageFold body={body} className={styles.body}>
        {/* #317: tags of real members become links; `names` (Buddy) keep the plain highlight. */}
        <LinkedText
          text={body}
          highlight={names}
          linkLabel={gif ? (href) => (chatGifFromUrl(href)?.id === gif.id ? "GIF ↗" : null) : undefined}
        />
      </MessageFold>
      {snapshot ? <TradingViewPreview key={snapshot.chartId} snapshot={snapshot} /> : null}
      {gif ? <ChatGif key={gif.id} gif={gif} /> : null}
    </div>
  );
}
