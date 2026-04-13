"use client";

import React, { useCallback, useEffect, useState } from "react";

const font = '"IBM Plex Mono", ui-monospace, Menlo, monospace';

type AdminUser = {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: string;
  last_sign_in_at: string | null;
};

type Invite = {
  id: string;
  email: string;
  invited_by_email: string;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  status: "pending" | "accepted" | "revoked";
};

type Confirm =
  | { kind: "role"; userId: string; email: string; nextRole: "user" | "admin" }
  | { kind: "revoke"; inviteId: string; email: string };

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function AdminClient({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmWorking, setConfirmWorking] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [uRes, iRes] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch("/api/admin/invites", { cache: "no-store" }),
      ]);
      if (!uRes.ok) throw new Error(`users: HTTP ${uRes.status}`);
      if (!iRes.ok) throw new Error(`invites: HTTP ${iRes.status}`);
      const uData = await uRes.json();
      const iData = await iRes.json();
      setUsers(uData.users ?? []);
      setInvites(iData.invites ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError(null);
    const email = inviteEmail.trim();
    if (!email) return;
    setInviteSending(true);
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === "user_exists") setInviteError("That email is already a user.");
        else if (data.error === "invite_pending") setInviteError("An invite for that email already exists.");
        else if (data.error === "invalid_email") setInviteError("Not a valid email.");
        else setInviteError(data.message ?? data.error ?? "Failed to send invite");
        return;
      }
      setInviteEmail("");
      await fetchAll();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviteSending(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setConfirmWorking(true);
    try {
      if (confirm.kind === "role") {
        const res = await fetch(`/api/admin/users/${confirm.userId}/role`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: confirm.nextRole }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
        }
      } else {
        const res = await fetch(`/api/admin/invites/${confirm.inviteId}/revoke`, { method: "POST" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
        }
      }
      setConfirm(null);
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      setConfirm(null);
    } finally {
      setConfirmWorking(false);
    }
  }

  return (
    <div style={{ fontFamily: font, color: "var(--text-primary)", padding: "32px 24px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>
          LONGBOARD.AI
        </div>
        <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>
          Admin
        </div>
      </div>

      {error && (
        <div style={{
          background: "var(--danger-20)", border: "1px solid var(--danger)", color: "var(--danger)",
          padding: "10px 14px", borderRadius: 4, marginBottom: 20, fontSize: 13,
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>{error}</span>
          <button onClick={() => setError(null)} style={bareBtn}>×</button>
        </div>
      )}

      {/* ── Users ── */}
      <SectionHeader title="Users" right={loading ? "loading…" : `${users.length} total`} />
      <div style={tableWrap}>
        <table style={tableStyle}>
          <thead>
            <tr style={{ background: "var(--bg)" }}>
              {["Email", "Role", "Created", "Last Sign In", ""].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              const isAdmin = u.role === "admin";
              return (
                <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={tdStyle}>{u.email}</td>
                  <td style={tdStyle}><RolePill role={u.role} /></td>
                  <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{fmtTime(u.created_at)}</td>
                  <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{fmtTime(u.last_sign_in_at)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {isAdmin ? (
                      <button
                        disabled={isSelf}
                        title={isSelf ? "Cannot demote yourself" : undefined}
                        onClick={() => setConfirm({ kind: "role", userId: u.id, email: u.email, nextRole: "user" })}
                        style={{ ...smallBtn("var(--danger)"), opacity: isSelf ? 0.4 : 1, cursor: isSelf ? "not-allowed" : "pointer" }}
                      >
                        DEMOTE
                      </button>
                    ) : (
                      <button
                        onClick={() => setConfirm({ kind: "role", userId: u.id, email: u.email, nextRole: "admin" })}
                        style={smallBtn("var(--accent)")}
                      >
                        PROMOTE
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && users.length === 0 && (
              <tr><td colSpan={5} style={{ ...tdStyle, color: "var(--text-secondary)", textAlign: "center", padding: 24 }}>No users yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Invites ── */}
      <div style={{ marginTop: 40 }}>
        <SectionHeader title="Invites" right={loading ? "loading…" : `${invites.length} total`} />

        <form onSubmit={sendInvite} style={{
          display: "flex", gap: 10, alignItems: "center", marginBottom: 16,
          padding: "12px 14px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
        }}>
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null); }}
            placeholder="user@example.com"
            autoComplete="off"
            required
            style={{
              flex: 1, background: "var(--bg)", border: "1px solid var(--border)",
              padding: "8px 10px", borderRadius: 3, color: "var(--text-primary)",
              fontFamily: font, fontSize: 13, outline: "none",
            }}
          />
          <button
            type="submit"
            disabled={inviteSending || !inviteEmail.trim()}
            style={{
              background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)",
              padding: "8px 14px", borderRadius: 3, fontFamily: font, fontSize: 11,
              fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
              cursor: inviteSending ? "wait" : "pointer", opacity: inviteSending ? 0.6 : 1,
            }}
          >
            {inviteSending ? "Sending…" : "Send Invite"}
          </button>
        </form>
        {inviteError && (
          <div style={{ color: "var(--danger)", fontSize: 12, marginTop: -8, marginBottom: 16 }}>{inviteError}</div>
        )}

        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                {["Email", "Invited By", "Sent", "Status", ""].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invites.map((inv) => (
                <tr key={inv.id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={tdStyle}>{inv.email}</td>
                  <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{inv.invited_by_email}</td>
                  <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{fmtTime(inv.created_at)}</td>
                  <td style={tdStyle}><StatusPill status={inv.status} /></td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    {inv.status === "pending" && (
                      <button
                        onClick={() => setConfirm({ kind: "revoke", inviteId: inv.id, email: inv.email })}
                        style={smallBtn("var(--danger)")}
                      >
                        REVOKE
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && invites.length === 0 && (
                <tr><td colSpan={5} style={{ ...tdStyle, color: "var(--text-secondary)", textAlign: "center", padding: 24 }}>No invites yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          confirm={confirm}
          working={confirmWorking}
          onConfirm={runConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/* ── Presentation helpers ── */

function SectionHeader({ title, right }: { title: string; right?: string }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border)",
    }}>
      <div style={{ fontSize: 14, color: "var(--text-secondary)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>
        {title}
      </div>
      {right && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{right}</div>}
    </div>
  );
}

function RolePill({ role }: { role: "user" | "admin" }) {
  const color = role === "admin" ? "var(--warning)" : "var(--text-secondary)";
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", border: `1px solid ${color}`,
      color, borderRadius: 2, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600,
    }}>
      {role}
    </span>
  );
}

function StatusPill({ status }: { status: "pending" | "accepted" | "revoked" }) {
  const color =
    status === "accepted" ? "var(--accent)" :
    status === "revoked" ? "var(--danger)" :
    "var(--text-secondary)";
  return (
    <span style={{
      fontSize: 10, padding: "2px 8px", border: `1px solid ${color}`,
      color, borderRadius: 2, textTransform: "uppercase", letterSpacing: 1, fontWeight: 600,
    }}>
      {status}
    </span>
  );
}

function ConfirmModal({
  confirm, working, onConfirm, onCancel,
}: {
  confirm: Confirm;
  working: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const title =
    confirm.kind === "role"
      ? (confirm.nextRole === "admin" ? "Promote to admin?" : "Demote to user?")
      : "Revoke invite?";

  const body =
    confirm.kind === "role"
      ? confirm.nextRole === "admin"
        ? <>This will grant <strong style={{ color: "var(--warning)" }}>{confirm.email}</strong> full admin access — including the ability to promote/demote other users and manage invites.</>
        : <>This will remove admin access from <strong style={{ color: "var(--warning)" }}>{confirm.email}</strong>. They'll retain their user account.</>
      : <>This will revoke the pending invite for <strong>{confirm.email}</strong>. They can be re-invited later.</>;

  const actionLabel = confirm.kind === "role"
    ? (confirm.nextRole === "admin" ? "PROMOTE" : "DEMOTE")
    : "REVOKE";

  const destructive = confirm.kind === "revoke" || (confirm.kind === "role" && confirm.nextRole === "user");
  const actionColor = destructive ? "var(--danger)" : "var(--accent)";

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
        padding: 24, minWidth: 380, maxWidth: 480, fontFamily: font,
      }}>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
          Confirm
        </div>
        <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 500, marginBottom: 12 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5, marginBottom: 20 }}>
          {body}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            disabled={working}
            onClick={onConfirm}
            style={{
              background: actionColor, color: "var(--bg)", border: "none",
              padding: "10px 18px", borderRadius: 3, fontFamily: font, fontSize: 12,
              fontWeight: 700, letterSpacing: 1.5, cursor: working ? "wait" : "pointer",
              opacity: working ? 0.6 : 1,
            }}
          >
            {working ? "…" : `CONFIRM ${actionLabel}`}
          </button>
          <button
            disabled={working}
            onClick={onCancel}
            style={{
              background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)",
              padding: "10px 18px", borderRadius: 3, fontFamily: font, fontSize: 12,
              fontWeight: 700, letterSpacing: 1.5, cursor: "pointer",
            }}
          >
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Shared styles ── */

const tableWrap: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden",
};
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const thStyle: React.CSSProperties = {
  textAlign: "left", padding: "10px 14px", fontSize: 10, color: "var(--text-secondary)",
  letterSpacing: 1.5, fontWeight: 500, borderBottom: "1px solid var(--border)",
};
const tdStyle: React.CSSProperties = { padding: "12px 14px", color: "var(--text-primary)" };

function smallBtn(color: string): React.CSSProperties {
  return {
    background: "transparent", border: `1px solid ${color}`, color,
    padding: "4px 10px", borderRadius: 3, fontFamily: font, fontSize: 10,
    fontWeight: 700, letterSpacing: 1, cursor: "pointer",
  };
}

const bareBtn: React.CSSProperties = {
  background: "none", border: "none", color: "var(--danger)",
  cursor: "pointer", fontFamily: font, fontSize: 16, fontWeight: 700, padding: "0 4px",
};
