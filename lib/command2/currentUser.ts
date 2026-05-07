import type { Command2MenuUser } from "@/components/command2/Command2UserMenu";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const COHORT_TAG_PREFIX = "boardroom-cohort-";

export async function getCommand2CurrentUser(): Promise<Command2MenuUser | null> {
  const auth = await getCurrentUser();
  if (!auth.ok) return null;

  const supabase = await createClient();
  const { data: tagRows } = await supabase
    .from("user_tags")
    .select("tag")
    .eq("user_id", auth.user.id)
    .like("tag", `${COHORT_TAG_PREFIX}%`);

  return {
    email: auth.user.email,
    role: auth.user.role,
    boardroomCohorts: (tagRows ?? [])
      .map((row) => row.tag.slice("boardroom-".length))
      .filter((cohort): cohort is string => Boolean(cohort))
      .sort(),
  };
}
