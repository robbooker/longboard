import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export default async function LabHeader() {
  const auth = await getCurrentUser();
  const loggedIn = auth.ok;

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        borderBottom: "1px solid rgba(21, 18, 11, 0.16)",
        padding: "14px 28px",
        background: "#f6f2e9",
      }}
    >
      <span
        style={{
          fontFamily: '"Courier New", Courier, monospace',
          fontSize: 12,
          letterSpacing: 1.6,
          textTransform: "uppercase",
          fontWeight: 700,
          color: "rgba(21, 18, 11, 0.72)",
        }}
      >
        Longboard Lab
      </span>

      {!loggedIn && (
        <Link
          href="/login"
          style={{
            fontFamily: '"Courier New", Courier, monospace',
            fontSize: 11,
            letterSpacing: 1.4,
            textTransform: "uppercase",
            fontWeight: 700,
            color: "rgba(21, 18, 11, 0.55)",
            textDecoration: "none",
          }}
        >
          Sign In
        </Link>
      )}
    </header>
  );
}
