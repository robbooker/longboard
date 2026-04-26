const font = "var(--font-labels)";

export type CalendarEvent = {
  id: string;
  title: string;
  subtitle: string | null;
  starts_at: string;
  ends_at: string | null;
  rsvp_url: string | null;
};

export default function CalendarCard({ events }: { events: CalendarEvent[] }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <div style={{
        fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2,
        textTransform: "uppercase", fontWeight: 600, marginBottom: 14,
      }}>
        Calendar
      </div>

      {events.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          No upcoming events.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {events.map((e) => <EventRow key={e.id} event={e} />)}
        </div>
      )}
    </div>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  const start = new Date(event.starts_at);
  const month = start.toLocaleDateString(undefined, { month: "short" }).toUpperCase();
  const day = start.toLocaleDateString(undefined, { day: "numeric" });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <DatePill month={month} day={day} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, color: "var(--text-primary)", fontWeight: 500,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {event.title}
        </div>
        {event.subtitle && (
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
            {event.subtitle}
          </div>
        )}
      </div>
      {event.rsvp_url && (
        <a
          href={event.rsvp_url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            fontSize: 10, color: "var(--accent)", textDecoration: "none",
            border: "1px solid var(--accent)", borderRadius: 3,
            padding: "3px 10px", letterSpacing: 1, textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          RSVP
        </a>
      )}
    </div>
  );
}

function DatePill({ month, day }: { month: string; day: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", minWidth: 48, padding: "6px 8px",
      background: "var(--bg)", border: "1px solid var(--border)",
      borderRadius: 4,
    }}>
      <div style={{ fontSize: 9, color: "var(--accent)", letterSpacing: 1, fontWeight: 700 }}>
        {month}
      </div>
      <div style={{ fontSize: 18, color: "var(--text-primary)", fontWeight: 600, lineHeight: 1.1 }}>
        {day}
      </div>
    </div>
  );
}
