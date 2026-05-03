"use client";

import { createClient } from "@/lib/supabase/client";
import UserMenu from "./UserMenu";

export default function LabUserMenu({
  email,
  boardroomCohorts,
}: {
  email: string;
  boardroomCohorts: string[];
}) {
  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <UserMenu
      email={email}
      boardroomCohorts={boardroomCohorts}
      onLogout={handleLogout}
    />
  );
}
