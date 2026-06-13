import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { talentCategoryIds, type TalentCategoryId } from "@/lib/talent/categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT_MAX_LEN = 5000;
const AVAILABILITY_MAX_LEN = 1000;
const COHORT_TAG_PREFIX = "boardroom-cohort-";

type TalentProfilePayload = {
  categories?: unknown;
  otherStrengths?: unknown;
  contributionInterests?: unknown;
  availability?: unknown;
};

function cleanText(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length > max) return { ok: false as const, text, max };
  return { ok: true as const, text };
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let payload: TalentProfilePayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const rawCategories = Array.isArray(payload.categories) ? payload.categories : [];
  const categories = Array.from(
    new Set(
      rawCategories.filter(
        (value): value is TalentCategoryId =>
          typeof value === "string" && talentCategoryIds.has(value as TalentCategoryId)
      )
    )
  );

  if (categories.length === 0) {
    return NextResponse.json({ error: "categories_required" }, { status: 400 });
  }

  const otherStrengths = cleanText(payload.otherStrengths, TEXT_MAX_LEN);
  if (!otherStrengths.ok) {
    return NextResponse.json({ error: "other_strengths_too_long", max: otherStrengths.max }, { status: 400 });
  }

  const contributionInterests = cleanText(payload.contributionInterests, TEXT_MAX_LEN);
  if (!contributionInterests.ok) {
    return NextResponse.json({ error: "contribution_interests_too_long", max: contributionInterests.max }, { status: 400 });
  }

  const availability = cleanText(payload.availability, AVAILABILITY_MAX_LEN);
  if (!availability.ok) {
    return NextResponse.json({ error: "availability_too_long", max: availability.max }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: tagRows, error: tagErr } = await supabase
    .from("user_tags")
    .select("tag")
    .eq("user_id", auth.user.id)
    .like("tag", `${COHORT_TAG_PREFIX}%`);

  if (tagErr) {
    return NextResponse.json({ error: "cohort_lookup_failed", message: tagErr.message }, { status: 500 });
  }

  const cohort = (tagRows ?? [])
    .map((row) => row.tag.slice("boardroom-".length))
    .filter((value): value is string => Boolean(value))
    .sort()[0];

  if (!cohort) {
    return NextResponse.json({ error: "no_cohort" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("boardroom_talent_profiles")
    .upsert(
      {
        user_id: auth.user.id,
        email: auth.user.email,
        cohort,
        categories,
        other_strengths: otherStrengths.text || null,
        contribution_interests: contributionInterests.text || null,
        availability: availability.text || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    )
    .select("categories, other_strengths, contribution_interests, availability, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "upsert_failed", message: error.message }, { status: 500 });
  }

  return NextResponse.json({
    categories: data.categories ?? [],
    otherStrengths: data.other_strengths ?? "",
    contributionInterests: data.contribution_interests ?? "",
    availability: data.availability ?? "",
    updatedAt: data.updated_at ?? null,
  });
}
