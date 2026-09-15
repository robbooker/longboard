import Link from "next/link";

/** Embed the canonical chat route so room access and features have one owner. */
export default function SharedChatPanel({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="panel dark" aria-label="Community chat" style={{ padding: 0, overflow: "hidden" }}>
      {signedIn ? (
        <iframe
          src="/chat?room=main&popout=1"
          title="Longboard community chat"
          loading="lazy"
          style={{ display: "block", width: "100%", height: "min(760px, 85dvh)", minHeight: 520, border: 0 }}
        />
      ) : (
        <div style={{ padding: 24 }}>
          <h2 style={{ margin: "0 0 12px" }}>COMMUNITY CHAT</h2>
          <p>Sign in to join LB MAIN and the other community rooms.</p>
          <Link href="/login?next=%2Fcommand2">Sign in to chat →</Link>
        </div>
      )}
      <div style={{ padding: "10px 16px", fontSize: 12 }}>
        <Link href="/chat?room=main" target="_blank" rel="noopener noreferrer">Open chat in a new tab ↗</Link>
      </div>
    </section>
  );
}
