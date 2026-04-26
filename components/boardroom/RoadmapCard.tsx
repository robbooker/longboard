const font = "var(--font-labels)";

export type RoadmapItem = {
  id: string;
  title: string;
  status: string;       // 'shipped' | 'in_flight' | 'next' | 'later'
  sort_order: number;
};

export default function RoadmapCard({ items }: { items: RoadmapItem[] }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <div style={{
        fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2,
        textTransform: "uppercase", fontWeight: 600, marginBottom: 14,
      }}>
        Roadmap
      </div>

      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          No roadmap items yet.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {items.map((item) => (
            <div key={item.id} style={{
              display: "flex", alignItems: "center", gap: 10,
              paddingBottom: 10, borderBottom: "1px solid var(--border)",
            }}>
              <StatusPill status={item.status} />
              <span style={{ fontSize: 13, color: "var(--text-primary)", flex: 1 }}>
                {item.title}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const { label, color } = describe(status);
  return (
    <span style={{
      display: "inline-block", minWidth: 76, textAlign: "center",
      fontSize: 9, padding: "3px 8px", border: `1px solid ${color}`,
      color, borderRadius: 2, textTransform: "uppercase", letterSpacing: 1,
      fontWeight: 600,
    }}>
      {label}
    </span>
  );
}

function describe(status: string): { label: string; color: string } {
  switch (status) {
    case "shipped":   return { label: "Shipped",   color: "var(--accent)" };
    case "in_flight": return { label: "In Flight", color: "var(--warning)" };
    case "next":      return { label: "Next",      color: "var(--text-primary)" };
    case "later":     return { label: "Later",     color: "var(--text-secondary)" };
    default:          return { label: status,      color: "var(--text-secondary)" };
  }
}
