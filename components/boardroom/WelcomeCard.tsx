const font = "var(--font-labels)";

export default function WelcomeCard({ markdown }: { markdown: string | null }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <div style={{
        fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2,
        textTransform: "uppercase", fontWeight: 600, marginBottom: 12,
      }}>
        Welcome
      </div>
      {markdown ? (
        <div style={{
          fontSize: 14, color: "var(--text-primary)", lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}>
          {markdown}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          Welcome message hasn't been published yet.
        </div>
      )}
    </div>
  );
}
