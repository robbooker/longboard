import type { Metadata } from "next";
import { redirect } from "next/navigation";
import MembersAdmin from "@/components/members/MembersAdmin";
import { getCurrentUser } from "@/lib/auth";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Members · Admin", robots: { index: false } };

/** #384: who bought what and what they can open. Admins only (the API checks again). */
export default async function AdminMembersPage() {
  const auth = await getCurrentUser();
  if (!auth.ok) redirect(`/login?next=${encodeURIComponent("/admin/members")}`);
  if (auth.user.role !== "admin") redirect("/");
  return <MembersAdmin />;
}
