const font = "var(--font-labels)";

export type Meeting = {
  id: string;
  title: string;
  summary: string | null;
  video_url: string | null;
  duration_seconds: number | null;
  tags: string[] | null;
  meeting_date: string;
};

export default function LatestMeetingCard({ meeting }: { meeting: Meeting | null }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <div style={{
        fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2,
        textTransform: "uppercase", fontWeight: 600, marginBottom: 14,
      }}>
        Latest Meeting
      </div>

      {!meeting ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          No meetings posted yet.
        </div>
      ) : (
        <>
          <VideoPlaceholder videoUrl={meeting.video_url} />
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 15, color: "var(--text-primary)", fontWeight: 500, marginBottom: 4 }}>
              {meeting.title}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: meeting.summary ? 8 : 0 }}>
              {fmtDate(meeting.meeting_date)}
              {meeting.duration_seconds ? ` · ${fmtDuration(meeting.duration_seconds)}` : ""}
            </div>
            {meeting.summary && (
              <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.55, marginBottom: 8 }}>
                {meeting.summary}
              </div>
            )}
            {meeting.tags && meeting.tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {meeting.tags.map((t) => (
                  <span key={t} style={{
                    fontSize: 10, padding: "2px 8px", border: "1px solid var(--border)",
                    color: "var(--text-secondary)", borderRadius: 10, letterSpacing: 0.5,
                  }}>
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function VideoPlaceholder({ videoUrl }: { videoUrl: string | null }) {
  // 16:9 box. Renders a real <video>/iframe when a URL is set; otherwise
  // a play-button placeholder. Provider (Mux/Loom/etc) gets picked when
  // the first real meeting gets posted — schema is a generic text URL
  // until then.
  return (
    <div style={{
      position: "relative", width: "100%", paddingBottom: "56.25%",
      background: "var(--bg)", border: "1px solid var(--border)",
      borderRadius: 4, overflow: "hidden",
    }}>
      <div style={{
        position: "absolute", inset: 0, display: "flex",
        alignItems: "center", justifyContent: "center",
      }}>
        {videoUrl ? (
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 56, height: 56, borderRadius: "50%",
              background: "var(--accent)", color: "var(--bg)",
              fontSize: 22, textDecoration: "none",
            }}
          >
            ▶
          </a>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 56, height: 56, borderRadius: "50%",
            background: "var(--surface)", border: "2px solid var(--border)",
            color: "var(--text-secondary)", fontSize: 22,
          }}>
            ▶
          </div>
        )}
      </div>
    </div>
  );
}

function fmtDate(d: string): string {
  try {
    return new Date(d + "T00:00:00").toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch {
    return d;
  }
}

function fmtDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}
