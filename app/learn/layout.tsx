import Command2NavLive from "@/components/command2/Command2NavLive";
import type { Command2MenuUser } from "@/components/command2/Command2UserMenu";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const COHORT_TAG_PREFIX = "boardroom-cohort-";

/** Renders the /command2 dark top nav above every /learn surface — the
 *  Daily index and essay detail pages alike. Sits outside the .daily-page
 *  and .essay-page scoped wrappers so the editorial font/line-height
 *  variables can't reach into the nav. User+cohort fetch mirrors
 *  /command2's page.tsx so the avatar menu lights up identically. */
export default async function LearnLayout({ children }: { children: React.ReactNode }) {
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
      {children}
    </>
  );
}
