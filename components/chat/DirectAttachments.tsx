"use client";
import { useAttachmentMetadata } from "./AttachmentMetadata";
import ChatAudioAttachment from "./ChatAudioAttachment";
import ChatImagePreview, { ChatImagePlaceholder } from "./ChatImagePreview";
import { useAttachmentFrames } from "./useAttachmentFrames";
import { attachmentSizeLabel, type ChatAttachmentMediaMap } from "@/lib/chatAttachmentMedia";
import styles from "./DirectInbox.module.css";
import shared from "./ChatAttachments.module.css";

export default function DirectAttachments({
  ids,
  conversationId,
  media,
}: {
  ids?: string[];
  conversationId: string;
  /** MEDIA-SIZE: server-known kinds and image sizes, so boxes are reserved before details load. */
  media?: ChatAttachmentMediaMap;
}) {
  const key = (ids ?? []).join(",");
  const { files, error, retry, anchor } = useAttachmentMetadata({ conversationId }, ids);
  const frame = useAttachmentFrames(media, files);
  if (!key) return null;
  return (
    <div
      ref={anchor}
      className={styles.attachments}
      style={{ gridTemplateColumns: "minmax(0,1fr)", maxWidth: "100%" }}
      aria-label="Shared files"
    >
      {(ids ?? []).map((id) => {
        const file = files.find((file) => file.id === id);
        const known = frame(id);
        const dims = known?.kind === "image" ? known : undefined;
        const image = file ? file.mime_type.startsWith("image/") : known?.kind === "image";
        return (
          <div
            key={id}
            className={image ? shared.imageFile : undefined}
            style={{ gridTemplateColumns: "minmax(0,1fr)", maxWidth: "100%" }}
          >
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
                  className={image ? shared.imageLabel : undefined}
                  title={image ? file.filename : undefined}
                  href={`/api/chat/attachments/${file.id}`}
                  download
                >
                  {file.filename} · {attachmentSizeLabel(file.byte_size)} ↓
                </a>
              </>
            ) : !error ? (
              known?.kind === "image" ? (
                <>
                  <ChatImagePlaceholder width={known.width} height={known.height} />
                  <span className={shared.imageLabel} />
                </>
              ) : (
                <>
                  <div style={{ width: 320, maxWidth: "100%", height: 220 }} role="status">
                    Loading attachment…
                  </div>
                  <span style={{ minHeight: 40 }} />
                </>
              )
            ) : null}
          </div>
        );
      })}
      {error ? (
        <p role="alert">
          {error}{" "}
          <button type="button" onClick={retry}>
            Retry files
          </button>
        </p>
      ) : null}
    </div>
  );
}
