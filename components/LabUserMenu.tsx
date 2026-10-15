"use client";

import { createClient } from "@/lib/supabase/client";
import UserMenu from "./UserMenu";
import { clearChatDeviceStore } from "@/lib/chatDeviceStore";

export default function LabUserMenu({
  email,
  isAdmin,
  boardroomCohorts,
}: {
  email: string;
  isAdmin: boolean;
  boardroomCohorts: string[];
}) {
  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Recent chat kept on this device (lib/chatDeviceStore.ts) leaves with the session.
    await clearChatDeviceStore();
    window.location.href = "/login";
  }

  return (
    <UserMenu
      email={email}
      isAdmin={isAdmin}
      boardroomCohorts={boardroomCohorts}
      onLogout={handleLogout}
    />
  );
}
