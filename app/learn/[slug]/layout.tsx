import "../essay-styles.css";
import ReadingProgress from "@/components/essays/ReadingProgress";
import Command2NavLive from "@/components/command2/Command2NavLive";
import type { Command2MenuUser } from "@/components/command2/Command2UserMenu";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const COHORT_TAG_PREFIX = "boardroom-cohort-";

/** Wraps essay detail pages in the editorial paper aesthetic. Pulled
 *  down from app/learn/layout.tsx in Phase 3L so the /learn index
 *  (now the Daily homepage) can own its own scoped surface without
 *  inheriting the essay chrome.
 *
 *  Renders the /command2 dark top nav as a sibling of `.essay-page`
 *  so essay-styles font/line-height inheritance can't reach into the
 *  nav. User+cohort fetch mirrors /command2's page.tsx. */
export default async function EssayDetailLayout({ children }: { children: React.ReactNode }) {
  const auth = await getCurrentUser();
  let currentUser: Command2MenuUser | null = null;

  if (auth.ok) {
    const supabase = await createClient();
    const { data: tagRows } = await supabase
      .from("user_tags")
      .select("tag")
      .eq("user_id", auth.user.id)
      .like("tag", `${COHORT_TAG_PREFIX}%`);

    currentUser = {
      email: auth.user.email,
      role: auth.user.role,
      boardroomCohorts: (tagRows ?? [])
        .map((row) => row.tag.slice("boardroom-".length))
        .filter((cohort): cohort is string => Boolean(cohort))
        .sort(),
    };
  }

  return (
    <>
      <Command2NavLive activeTab="learn" currentUser={currentUser} />
      <div className="essay-page">
        <ReadingProgress />
        <div className="essay-page-content">{children}</div>
      </div>
    </>
  );
}
