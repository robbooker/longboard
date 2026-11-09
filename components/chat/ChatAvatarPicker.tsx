"use client";
// #410: the Picture section of Profile settings. Loaded only when the dialog opens.
//
// Choose a photo -> it goes straight to private storage -> the server checks it really is a picture,
// turns it upright and strips its metadata (location included) and sends back that cleaned copy ->
// the member drags and zooms it inside the circle -> Save makes the 256px and 64px pictures.
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { ChatMember } from "@/lib/chatDirectMessages";
import { chatAvatarColor, chatAvatarUrl, chatInitials } from "@/lib/chatAvatar";
import { validChatMember } from "@/lib/chatMemberName";
import styles from "./ChatAvatarPicker.module.css";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_ZOOM = 4;
const VIEW = 220;
const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.heic,.heif";
type Crop = { x: number; y: number; zoom: number };
type Draft = { uploadId: string; url: string; width: number; height: number };

async function post(body: unknown) {
  const response = await fetch("/api/chat/avatar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response;
}
async function failure(response: Response, fallback: string) {
  const data = await response.json().catch(() => null);
  return new Error(typeof data?.error === "string" && data.error.length < 200 ? data.error : fallback);
}

/** Keeps the circle inside the picture (the server makes the same check). */
function clampCrop(crop: Crop, width: number, height: number): Crop {
  const zoom = Math.min(MAX_ZOOM, Math.max(1, crop.zoom));
  const side = Math.min(width, height) / zoom;
  const fit = (value: number, size: number) =>
    Math.min(1 - side / 2 / size, Math.max(side / 2 / size, Number.isFinite(value) ? value : 0.5));
  return { x: fit(crop.x, width), y: fit(crop.y, height), zoom };
}

export default function ChatAvatarPicker({
  accountId,
  member,
  onMember,
}: {
  accountId: string;
  member: ChatMember;
  onMember: (update: { accountId: string; member: ChatMember }) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "uploading" | "cropping" | "saving" | "removing">("idle");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [crop, setCrop] = useState<Crop>({ x: 0.5, y: 0.5, zoom: 1 });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [failedUrl, setFailedUrl] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const live = useRef<Draft | null>(null);
  live.current = draft;
  const hint = useId(),
    zoomId = useId();

  // Leaving the dialog drops an unsaved upload.
  useEffect(
    () => () => {
      const open = live.current;
      if (!open) return;
      URL.revokeObjectURL(open.url);
      void post({ action: "discard", uploadId: open.uploadId }).catch(() => undefined);
    },
    [],
  );

  function reset() {
    if (draft) URL.revokeObjectURL(draft.url);
    setDraft(null);
    setCrop({ x: 0.5, y: 0.5, zoom: 1 });
    setPhase("idle");
    if (input.current) input.current.value = "";
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setError("");
    setMessage("");
    if (file.size > MAX_BYTES) {
      setError("Pictures must be 10 MB or smaller.");
      if (input.current) input.current.value = "";
      return;
    }
    if (draft) {
      URL.revokeObjectURL(draft.url);
      void post({ action: "discard", uploadId: draft.uploadId }).catch(() => undefined);
      setDraft(null);
    }
    setPhase("uploading");
    try {
      const start = await post({ action: "start", byteSize: file.size });
      if (!start.ok) throw await failure(start, "Your picture could not be uploaded. Please try again.");
      const { uploadId, url } = await start.json();
      // Sent as plain bytes: the server decides what the file is from its contents.
      const sent = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", "x-upsert": "false" },
        body: file,
      });
      if (!sent.ok)
        throw new Error(
          sent.status === 413
            ? "Pictures must be 10 MB or smaller."
            : "Your picture could not be uploaded. Please try again.",
        );
      const preview = await post({ action: "preview", uploadId });
      if (!preview.ok)
        throw await failure(preview, "That picture couldn't be read. Please try a different photo.");
      const blob = await preview.blob();
      const width = Number(preview.headers.get("X-Avatar-Width")) || 1,
        height = Number(preview.headers.get("X-Avatar-Height")) || 1;
      setDraft({ uploadId, url: URL.createObjectURL(blob), width, height });
      setCrop({ x: 0.5, y: 0.5, zoom: 1 });
      setPhase("cropping");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your picture could not be uploaded.");
      setPhase("idle");
      if (input.current) input.current.value = "";
    }
  }

  async function save() {
    if (!draft || phase !== "cropping") return;
    setPhase("saving");
    setError("");
    try {
      const response = await post({ action: "save", uploadId: draft.uploadId, crop });
      if (!response.ok) throw await failure(response, "Your picture could not be saved. Please try again.");
      const data = await response.json();
      if (data.accountId !== accountId || !validChatMember(data.member) || data.member.id !== member.id)
        throw new Error("Your account changed. Please reopen profile settings.");
      URL.revokeObjectURL(draft.url);
      live.current = null;
      setDraft(null);
      setPhase("idle");
      if (input.current) input.current.value = "";
      onMember({ accountId: data.accountId, member: data.member });
      setMessage("Your picture has been updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your picture could not be saved.");
      setPhase("cropping");
    }
  }

  async function remove() {
    if (!window.confirm("Remove your picture? Your initials will show instead.")) return;
    setPhase("removing");
    setError("");
    setMessage("");
    try {
      const response = await post({ action: "remove" });
      if (!response.ok) throw await failure(response, "Your picture could not be removed. Please try again.");
      const data = await response.json();
      if (data.accountId === accountId && validChatMember(data.member) && data.member.id === member.id)
        onMember({ accountId, member: { ...data.member, avatar_path: null } });
      setMessage("Your picture was removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your picture could not be removed.");
    } finally {
      setPhase("idle");
    }
  }

  // ---- Drag and zoom inside the circle ----
  const scale = draft ? (VIEW / Math.min(draft.width, draft.height)) * crop.zoom : 1;
  const move = (dx: number, dy: number, zoom = crop.zoom) => {
    if (!draft) return;
    setCrop((current) =>
      clampCrop(
        { x: current.x - dx / (scale * draft.width), y: current.y - dy / (scale * draft.height), zoom },
        draft.width,
        draft.height,
      ),
    );
  };
  const setZoom = (zoom: number) =>
    draft && setCrop((current) => clampCrop({ ...current, zoom }, draft.width, draft.height));
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinch.current = null;
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const last = drag.current.get(event.pointerId);
    if (!last) return;
    const now = { x: event.clientX, y: event.clientY };
    drag.current.set(event.pointerId, now);
    if (drag.current.size === 2) {
      const [a, b] = [...drag.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current) setZoom(crop.zoom * (distance / pinch.current));
      pinch.current = distance;
      return;
    }
    move(now.x - last.x, now.y - last.y);
  }
  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    drag.current.delete(event.pointerId);
    pinch.current = null;
  }
  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 20 : 5;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (moves[event.key]) {
      event.preventDefault();
      move(...moves[event.key]);
    } else if (event.key === "+" || event.key === "=") setZoom(crop.zoom + 0.1);
    else if (event.key === "-") setZoom(crop.zoom - 0.1);
  }

  const busy = phase === "uploading" || phase === "saving" || phase === "removing";
  const currentUrl = chatAvatarUrl(member.avatar_path, 256);
  const showPicture = currentUrl && failedUrl !== currentUrl;
  return (
    <section className={styles.picture} aria-label="Picture">
      <p className={styles.label}>Picture</p>
      {draft ? (
        <div className={styles.cropper}>
          <div
            className={styles.viewport}
            data-avatar-crop
            style={{ width: VIEW, height: VIEW }}
            tabIndex={0}
            role="img"
            aria-label="Your picture. Drag to move it, use the slider or + and - to zoom, then save."
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={pointerUp}
            onPointerCancel={pointerUp}
            onWheel={(event) => setZoom(crop.zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08))}
            onKeyDown={keyDown}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- a local preview (object URL) */}
            <img
              src={draft.url}
              alt=""
              draggable={false}
              style={{
                width: draft.width * scale,
                height: draft.height * scale,
                left: VIEW / 2 - crop.x * draft.width * scale,
                top: VIEW / 2 - crop.y * draft.height * scale,
              }}
            />
          </div>
          <label htmlFor={zoomId} className={styles.zoom}>
            Zoom
            <input
              id={zoomId}
              type="range"
              min={1}
              max={MAX_ZOOM}
              step={0.01}
              value={crop.zoom}
              disabled={busy}
              onChange={(event) => setZoom(Number(event.target.value))}
            />
          </label>
          <p className={styles.hint}>Drag the picture to center your face.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy} onClick={() => void save()}>
              {phase === "saving" ? "Saving…" : "Save picture"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                void post({ action: "discard", uploadId: draft.uploadId }).catch(() => undefined);
                live.current = null;
                reset();
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.current}>
          <span
            className={styles.preview}
            data-avatar={showPicture ? "picture" : "initials"}
            style={{ background: showPicture ? "transparent" : chatAvatarColor(member.id) }}
          >
            {showPicture ? (
              // eslint-disable-next-line @next/next/no-img-element -- a fixed, already-sized storage file
              <img
                src={currentUrl}
                alt="Your picture"
                width={256}
                height={256}
                onError={() => setFailedUrl(currentUrl)}
              />
            ) : (
              chatInitials(member.display_name)
            )}
          </span>
          <div className={styles.choose}>
            <div className={styles.actions}>
              <button
                type="button"
                disabled={busy}
                onClick={() => input.current?.click()}
                aria-describedby={hint}
              >
                {phase === "uploading" ? "Uploading…" : member.avatar_path ? "Change picture" : "Add picture"}
              </button>
              {member.avatar_path && (
                <button type="button" disabled={busy} onClick={() => void remove()}>
                  {phase === "removing" ? "Removing…" : "Remove picture"}
                </button>
              )}
            </div>
            <p id={hint} className={styles.hint}>
              JPG, PNG, WebP or HEIC (iPhone), up to 10 MB.
            </p>
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        aria-label="Choose a picture"
        onChange={(event) => void choose(event.target.files?.[0])}
      />
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
