"use client";
import { useState } from "react";
import { tokenizeChatMessage, tradingViewSnapshotFromText, type TradingViewSnapshot } from "@/lib/publicChat";
import { renderMentions, useMentionMembers } from "./MemberMention";
import { chatGifFromText, chatGifFromUrl } from "@/lib/chatGifs";
import { ChatGif } from "./ChatGif";
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

export default function ChatMessageBody({ body, names = [] }: { body: string; names?: string[] }) {
  const snapshot = tradingViewSnapshotFromText(body);
  const gif = chatGifFromText(body);
  // #317: tags of real members become links; `names` (Buddy) keep the plain highlight.
  const members = useMentionMembers(body);
  return (
    <div className={styles.bodyBlock}>
      <p className={styles.body}>
        {tokenizeChatMessage(body).map((part, index) =>
          part.kind === "link" ? (
            <a
              className={styles.bodyLink}
              href={part.href}
              target="_blank"
              rel="noopener noreferrer"
              key={`${part.href}-${index}`}
            >
              {gif && chatGifFromUrl(part.href)?.id === gif.id ? "GIF ↗" : part.value}
            </a>
          ) : (
            <span key={`text-${index}`}>
              {renderMentions(part.value, members, names)}
            </span>
          ),
        )}
      </p>
      {snapshot ? <TradingViewPreview key={snapshot.chartId} snapshot={snapshot} /> : null}
      {gif ? <ChatGif key={gif.id} gif={gif} /> : null}
    </div>
  );
}
