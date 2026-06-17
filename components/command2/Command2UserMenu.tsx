"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Command2MenuUser = {
  id: string;
  email: string;
  role: "user" | "admin";
  boardroomCohorts: string[];
};

export default function Command2UserMenu({ user }: { user: Command2MenuUser | null }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const initials = getInitials(user?.email);

  useEffect(() => {
    if (!open) return;

    function onDocMouseDown(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function handleLogout() {
    setOpen(false);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const boardroomCohorts = user?.boardroomCohorts ?? [];

  return (
    <div ref={wrapRef} className="account-menu">
      <button
        type="button"
        className="avatar account-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={user ? "Open user menu" : "Open sign in menu"}
        onClick={() => setOpen((next) => !next)}
      >
        {initials}
      </button>

      {open && (
        <div className="account-panel" role="menu">
          {user ? (
            <>
              {boardroomCohorts.map((cohort) => {
                const number = cohort.replace(/^cohort-/, "") || cohort;
                return (
                  <Link
                    key={cohort}
                    href="/boardroom"
                    className="account-item account-item-accent"
                    role="menuitem"
                    onClick={() => setOpen(false)}
                  >
                    Boardroom {number}
                  </Link>
                );
              })}

              {user.role === "admin" && (
                <Link
                  href="/admin"
                  className="account-item account-item-accent"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  Admin
                </Link>
              )}

              <Link
                href="/settings"
                className="account-item"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                Settings
              </Link>

              <Link
                href="/bugs"
                className="account-item"
                role="menuitem"
                onClick={() => setOpen(false)}
              >
                Report Bug
              </Link>

              <button
                type="button"
                className="account-item account-item-danger"
                role="menuitem"
                onClick={handleLogout}
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              href="/login"
              className="account-item account-item-accent"
              role="menuitem"
              onClick={() => setOpen(false)}
            >
              Sign in
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function getInitials(email: string | undefined): string {
  if (!email) return "?";
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2
    ? `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`
    : name.slice(0, 2);
  return letters.toUpperCase() || "?";
}
