const font = "var(--font-labels)";

export type Announcement = {
  id: string;
  title: string;
  body: string | null;
  kind: string;       // 'info' | 'success' | 'warning' (string in DB)
  posted_at: string;
};

export default function AnnouncementsCard({ items }: { items: Announcement[] }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <div style={{
        fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2,
        textTransform: "uppercase", fontWeight: 600, marginBottom: 14,
      }}>
        Announcements
      </div>

      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          No announcements yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {items.map((a) => <AnnouncementRow key={a.id} item={a} />)}
        </div>
      )}
    </div>
  );
}

function AnnouncementRow({ item }: { item: Announcement }) {
  const accentColor = colorFor(item.kind);
  return (
    <div style={{
      display: "flex", gap: 12, paddingLeft: 12,
      borderLeft: `3px solid ${accentColor}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13, color: "var(--text-primary)", fontWeight: 500, marginBottom: 2,
        }}>
          {item.title}
        </div>
        {item.body && (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 4 }}>
            {item.body}
          </div>
        )}
        <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 0.5 }}>
          {fmtTime(item.posted_at)}
        </div>
      </div>
    </div>
  );
}

function colorFor(kind: string): string {
  switch (kind) {
    case "success": return "var(--accent)";
    case "warning": return "var(--warning)";
    default:        return "var(--text-secondary)";
  }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short", day: "numeric",
    });
  } catch {
    return iso;
  }
}
