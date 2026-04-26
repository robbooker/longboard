const font = "var(--font-labels)";

export type FeatureRequest = {
  id: string;
  title: string;
  upvote_count: number;
};

export default function FeatureRequestsCard({ items }: { items: FeatureRequest[] }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <div style={{
        fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2,
        textTransform: "uppercase", fontWeight: 600, marginBottom: 14,
      }}>
        Feature Requests
      </div>

      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          No feature requests yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((r) => (
            <div key={r.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              paddingBottom: 10, borderBottom: "1px solid var(--border)",
            }}>
              <UpvoteCount count={r.upvote_count} />
              <span style={{ fontSize: 13, color: "var(--text-primary)", flex: 1 }}>
                {r.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UpvoteCount({ count }: { count: number }) {
  // Read-only badge in v1. Vote toggle wires up in Commit 6.
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minWidth: 36, padding: "4px 6px",
      background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4,
    }}>
      <div style={{ fontSize: 10, color: "var(--accent)", lineHeight: 1 }}>▲</div>
      <div style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 600, lineHeight: 1.2 }}>
        {count}
      </div>
    </div>
  );
}
