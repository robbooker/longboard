"use client";
// #410: a member's own picture where their initials tile was, and a small picture beside names in
// lists. The 64px file serves every small spot; it is lazy-loaded and cached for good (each picture
// has its own name). A picture that fails to load falls back to the initials tile.
import { memo, useState, type CSSProperties } from "react";
import { chatAvatarColor, chatAvatarUrl, chatInitials, type ChatAvatarSize } from "@/lib/chatAvatar";
import { useChatAvatar } from "./ChatUpdates";
import styles from "./ChatAvatar.module.css";

/** The tile beside a message: the member's picture, or the initials tile (unchanged) without one. */
export const AvatarTile = memo(function AvatarTile({
  className,
  memberId,
  path,
  name,
  colorKey,
  bot,
  buddy,
  size = 64,
}: {
  className?: string;
  memberId?: string | null;
  /** The picture name the server sent with the row; your own picture always comes from your identity. */
  path?: string | null;
  name: string;
  colorKey: string;
  /** Bots never show a picture. */
  bot?: boolean;
  /** Marks Buddy's tile (data-bot), as the thread panel styles it. */
  buddy?: boolean;
  size?: ChatAvatarSize;
}) {
  const current = useChatAvatar(memberId, path);
  const url = bot ? null : chatAvatarUrl(current, size);
  const [failed, setFailed] = useState<string | null>(null);
  const picture = url && failed !== url ? url : null;
  return (
    <span
      className={className}
      aria-hidden="true"
      data-bot={buddy || undefined}
      data-avatar={picture ? "picture" : "initials"}
      style={{ background: picture ? "transparent" : chatAvatarColor(colorKey) }}
    >
      {picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- a fixed, already-sized storage file
        <img
          className={styles.face}
          src={picture}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(picture)}
        />
      ) : (
        chatInitials(name)
      )}
    </span>
  );
});

/** A small round picture before a name in a list; nothing at all when the member has none. */
export const AvatarBadge = memo(function AvatarBadge({
  memberId,
  path,
  px = 22,
  style,
}: {
  memberId?: string | null;
  path?: string | null;
  px?: number;
  style?: CSSProperties;
}) {
  const current = useChatAvatar(memberId, path);
  const url = chatAvatarUrl(current, 64);
  const [failed, setFailed] = useState<string | null>(null);
  if (!url || failed === url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a fixed, already-sized storage file
    <img
      className={styles.badge}
      src={url}
      alt=""
      aria-hidden="true"
      width={px}
      height={px}
      style={{ width: px, height: px, ...style }}
      loading="lazy"
      decoding="async"
      draggable={false}
      data-avatar="picture"
      onError={() => setFailed(url)}
    />
  );
});
