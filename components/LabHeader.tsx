import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import LabUserMenu from "./LabUserMenu";

const COHORT_TAG_PREFIX = "boardroom-cohort-";

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

      {auth.ok ? (
        <LabUserMenu email={auth.user.email} boardroomCohorts={cohorts} />
      ) : (
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
