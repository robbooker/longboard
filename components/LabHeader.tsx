import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import LabUserMenu from "./LabUserMenu";

const COHORT_TAG_PREFIX = "boardroom-cohort-";
const ink = "#0F0E0C";
const fg = "#0F0E0C";
const cream = "#FCFBF8";
const amber = "#F5A524";
const gold = "#B8860B";
const line = "rgba(15,14,12,0.14)";

const fonts = {
  body: "Helvetica, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
};

function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <Link
      href="/"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        fontFamily: fonts.body,
        fontWeight: 800,
        fontSize: size,
        letterSpacing: 0,
        color: fg,
        textDecoration: "none",
      }}
    >
      <span
        style={{
          width: size + 8,
          height: size + 8,
          background: amber,
          color: ink,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 900,
          fontSize: size - 3,
          border: `1.5px solid ${ink}`,
          boxShadow: `2px 2px 0 ${ink}`,
        }}
      >
        L
      </span>
      <span>
        LONGBOARD
        <span
          style={{
            fontFamily: fonts.serif,
            fontStyle: "italic",
            fontWeight: 500,
            color: gold,
          }}
        >
          AI
        </span>
      </span>
    </Link>
  );
}

export default async function LabHeader() {
  const auth = await getCurrentUser();

  // Mirrors /api/auth/me's cohort query so UserMenu's Boardroom links
  // render the same way they do under DashboardNav. RLS on user_tags
  // limits SELECT to the user's own rows.
  let cohorts: string[] = [];
  if (auth.ok) {
    const supabase = await createClient();
    const { data: tagRows } = await supabase
      .from("user_tags")
      .select("tag")
      .eq("user_id", auth.user.id)
      .like("tag", `${COHORT_TAG_PREFIX}%`);
    cohorts = (tagRows ?? [])
      .map((r) => r.tag.slice("boardroom-".length))
      .filter((c): c is string => Boolean(c))
      .sort();
  }

  return (
    <header
      style={{
        borderBottom: `1px solid ${line}`,
        background: "rgba(252,251,248,0.92)",
        backdropFilter: "saturate(140%) blur(8px)",
        WebkitBackdropFilter: "saturate(140%) blur(8px)",
        position: "sticky",
        top: 0,
        zIndex: 100,
      }}
    >
      <style>
        {`
          @media (max-width: 768px) {
            .lab-site-nav-inner {
              flex-direction: column;
              gap: 16px;
              align-items: center;
            }

            .lab-site-nav-links {
              gap: 18px !important;
              flex-wrap: wrap;
              justify-content: center;
            }
          }
        `}
      </style>
      <div
        className="lab-site-nav-inner"
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "22px 48px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Wordmark size={18} />
        <nav
          className="lab-site-nav-links"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 32,
            fontFamily: fonts.body,
            fontSize: 14,
          }}
        >
          <Link
            href="/learn"
            style={{ color: fg, textDecoration: "none" }}
          >
            Learn
          </Link>
          <span style={{ color: fg }}>Podcast</span>
          <span style={{ color: fg }}>Pricing</span>
          {auth.ok ? (
            <LabUserMenu email={auth.user.email} boardroomCohorts={cohorts} />
          ) : (
            <Link
              href="/login"
              style={{
                background: ink,
                color: cream,
                padding: "10px 18px",
                fontWeight: 700,
                fontSize: 13,
                letterSpacing: 0.4,
                textTransform: "uppercase",
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              Member sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
