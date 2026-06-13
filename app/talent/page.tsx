import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Command2Header from "@/components/command2/Command2Header";
import TalentProfileForm, { type TalentProfile } from "@/components/talent/TalentProfileForm";
import { getCommand2CurrentUser } from "@/lib/command2/currentUser";
import { createClient } from "@/lib/supabase/server";
import { talentCategories } from "@/lib/talent/categories";

export const metadata: Metadata = {
  title: "Talent Inventory · Longboard",
  description:
    "Boardroom member form for sharing strengths, experience, and ways to contribute to Longboard.",
};

export const dynamic = "force-dynamic";

export default async function TalentPage() {
  const currentUser = await getCommand2CurrentUser();
  if (!currentUser) redirect("/login");
  if (currentUser.boardroomCohorts.length === 0) redirect("/");

  const supabase = await createClient();
  const { data } = await supabase
    .from("boardroom_talent_profiles")
    .select("categories, other_strengths, contribution_interests, availability, updated_at")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  const initialProfile: TalentProfile | null = data
    ? {
        categories: Array.isArray(data.categories) ? data.categories : [],
        otherStrengths: data.other_strengths ?? "",
        contributionInterests: data.contribution_interests ?? "",
        availability: data.availability ?? "",
        updatedAt: data.updated_at ?? null,
      }
    : null;

  return (
    <>
      <Command2Header activeTab="library" currentUser={currentUser} />
      <TalentProfileForm
        categories={talentCategories}
        initialProfile={initialProfile}
        userEmail={currentUser.email}
      />
    </>
  );
}
