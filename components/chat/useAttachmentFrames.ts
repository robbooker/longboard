"use client";
import { useRef } from "react";
import type { ChatAttachment } from "@/lib/chatAttachmentValidation";
import {
  mediaFromRow,
  type ChatAttachmentMedia,
  type ChatAttachmentMediaMap,
} from "@/lib/chatAttachmentMedia";

/**
 * MEDIA-SIZE: the box each attachment keeps for the life of the row. The message's own
 * `attachment_media` (sent with history, threads, DMs and realtime) wins and is kept even if
 * a later copy of the row arrives without it, so the box never changes once shown. Rows that
 * arrived without it (a just-sent message) take the file details' size once: one settle.
 */
export function useAttachmentFrames(media: ChatAttachmentMediaMap | undefined, files: ChatAttachment[]) {
  const known = useRef(new Map<string, ChatAttachmentMedia>());
  return (id: string): ChatAttachmentMedia | undefined => {
    const kept = known.current.get(id);
    if (kept) return kept;
    const next = media?.[id] ?? fromFile(files.find((file) => file.id === id));
    if (next) known.current.set(id, next);
    return next;
  };
}

function fromFile(file: ChatAttachment | undefined) {
  return file ? mediaFromRow(file) : undefined;
}
