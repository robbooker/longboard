"use client";
import { useAttachmentMetadata } from "./AttachmentMetadata";
import Image from "next/image";
import ChatAudioAttachment from "./ChatAudioAttachment";
import ChatImagePreview, { ChatImagePlaceholder } from "./ChatImagePreview";
import { useAttachmentFrames } from "./useAttachmentFrames";
import { attachmentSizeLabel as size, type ChatAttachmentMediaMap } from "@/lib/chatAttachmentMedia";
import { attachmentAccept } from "@/lib/chatAttachmentValidation";
import type { useAttachments } from "./hooks/useAttachments";
import styles from "./ChatAttachments.module.css";
export function AttachmentPicker({
  uploads,
  disabled = false,
}: {
  uploads: ReturnType<typeof useAttachments>;
  disabled?: boolean;
}) {
  return (
    <div className={styles.drafts}>
      <input
        ref={uploads.input}
        type="file"
        hidden
        multiple
        accept={attachmentAccept(uploads.scope)}
        aria-label="Attach files"
        disabled={disabled}
        onChange={(e) => {
          uploads.addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      {uploads.files.length > 0 && (
        <ul aria-label="Attachment drafts">
          {uploads.files.map((file) => (
            <li key={file.key}>
              {file.preview && <Image unoptimized src={file.preview} width={64} height={64} alt="" />}
              <div>
                <strong>{file.name}</strong>
                <small>{size(file.size)}</small>
                <span role="status">
                  {file.state === "ready"
                    ? "Ready to send"
                    : file.state === "scanning"
                      ? "Checking file… you can send now"
                      : file.state === "error"
                        ? file.error
                        : `Uploading ${file.progress}%`}
                </span>
                {file.state === "uploading" && (
                  <progress aria-label={`Uploading ${file.name}`} max={100} value={file.progress} />
                )}
              </div>
              <button
                type="button"
                disabled={disabled}
                aria-label={`Remove ${file.name}`}
                onClick={() => uploads.remove(file.key)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {uploads.error && <p role="alert">{uploads.error}</p>}
      {uploads.files.length > 0 && (
        <small>Up to 3 files · 10 MB each (voice: 2 min / 5 MB) · Files are scanned before sharing.</small>
      )}
    </div>
  );
}
export function ChatAttachments({
  ids,
  room,
  media,
}: {
  ids?: string[];
  room: string;
  /** MEDIA-SIZE: server-known kinds and image sizes, so boxes are reserved before details load. */
  media?: ChatAttachmentMediaMap;
}) {
  const key = ids?.join(",") || "";
  const { files, error, retry, anchor } = useAttachmentMetadata({ room }, ids);
  const frame = useAttachmentFrames(media, files);
  const failed = !!error;
  if (!key) return null;
  return (
    <div ref={anchor} className={styles.files} aria-label="Message attachments">
      {(ids ?? []).map((id) => {
        const file = files.find((file) => file.id === id);
        const known = frame(id);
        const dims = known?.kind === "image" ? known : undefined;
        const image = file ? file.mime_type.startsWith("image/") : known?.kind === "image";
        return (
          <div key={id} className={image ? `${styles.file} ${styles.imageFile}` : styles.file}>
            {file ? (
              <>
                {file.mime_type === "audio/wav" && <ChatAudioAttachment file={file} />}
                {image && (
                  <ChatImagePreview
                    width={dims?.width}
                    height={dims?.height}
                    thumbnailSrc={
                      file.thumbnail_available === false
                        ? undefined
                        : `/api/chat/attachments/${file.id}?thumbnail=1`
                    }
                    src={`/api/chat/attachments/${file.id}?preview=1`}
                    alt={file.filename}
                    downloadHref={`/api/chat/attachments/${file.id}`}
                  />
                )}
                <a
                  className={image ? styles.imageLabel : undefined}
                  href={`/api/chat/attachments/${file.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={image ? file.filename : undefined}
                >
                  {file.filename} · {size(file.byte_size)} ↓
                </a>
              </>
            ) : !failed ? (
              known?.kind === "image" ? (
                <>
                  <ChatImagePlaceholder width={known.width} height={known.height} />
                  <span className={styles.imageLabel} />
                </>
              ) : (
                <>
                  <div className={styles.placeholderFrame} role="status">
                    Loading attachment…
                  </div>
                  <span className={styles.imageLabel} />
                </>
              )
            ) : null}
          </div>
        );
      })}
      {failed && (
        <button type="button" onClick={retry}>
          Attachments unavailable · Retry
        </button>
      )}
    </div>
  );
}
