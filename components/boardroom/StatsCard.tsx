const font = "var(--font-labels)";

export type BoardroomStats = {
  total_sales_display: string;
  total_sales_subtext: string | null;
  collected_display: string;
  collected_subtext: string | null;
  members_display: string;
  members_subtext: string | null;
  new_leads_display: string;
  new_leads_subtext: string | null;
};

export default function StatsCard({ stats }: { stats: BoardroomStats | null }) {
  // Singleton-per-cohort row. If the row hasn't been created yet (admin
  // hasn't visited /admin/boardroom to seed it) fall back to the
  // schema defaults so the UI never renders blank.
  const s: BoardroomStats = stats ?? {
    total_sales_display: "$0", total_sales_subtext: null,
    collected_display: "$0", collected_subtext: null,
    members_display: "0 / 0", members_subtext: null,
    new_leads_display: "0", new_leads_subtext: null,
  };

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <div style={{
        fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2,
        textTransform: "uppercase", fontWeight: 600, marginBottom: 16,
      }}>
        Stats &amp; Revenue
      </div>

      <div className="boardroom-stats-grid" style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14,
      }}>
        <Metric label="Total Sales"     value={s.total_sales_display} subtext={s.total_sales_subtext} />
        <Metric label="Collected"        value={s.collected_display}    subtext={s.collected_subtext} />
        <Metric label="Members"          value={s.members_display}      subtext={s.members_subtext} />
        <Metric label="New Leads Today"  value={s.new_leads_display}    subtext={s.new_leads_subtext} />
      </div>

      <style>{`
        @media (max-width: 720px) {
          .boardroom-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}

function Metric({ label, value, subtext }: { label: string; value: string; subtext: string | null }) {
  return (
    <div style={{
      background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4,
      padding: "14px 16px",
    }}>
      <div style={{
        fontSize: 9, color: "var(--text-secondary)", letterSpacing: 1.5,
        textTransform: "uppercase", fontWeight: 600, marginBottom: 8,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 22, color: "var(--text-primary)", fontWeight: 600,
        letterSpacing: 0.5, lineHeight: 1.1,
      }}>
        {value}
      </div>
      {subtext && (
        <div style={{ fontSize: 10, color: "var(--text-secondary)", marginTop: 6, letterSpacing: 0.3 }}>
          {subtext}
        </div>
      )}
    </div>
  );
}
