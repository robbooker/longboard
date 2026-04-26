"use client";

import React, { useCallback, useEffect, useState } from "react";

const font = "var(--font-labels)";

type AdminUser = {
  id: string;
  email: string;
  role: "user" | "admin";
  created_at: string;
  last_sign_in_at: string | null;
  tags: string[];
};

type BulkTagResult = {
  tag: string;
  matched: string[];
  unmatched: string[];
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

type SignupRequest = {
  id: string;
  email: string;
  message: string | null;
  status: "pending" | "invited" | "rejected" | "duplicate";
  created_at: string;
  source_ip: string | null;
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
  const [signupRequests, setSignupRequests] = useState<SignupRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [signupActionId, setSignupActionId] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [confirmWorking, setConfirmWorking] = useState(false);

  const [manageTagsUser, setManageTagsUser] = useState<AdminUser | null>(null);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [uRes, iRes, sRes] = await Promise.all([
        fetch("/api/admin/users", { cache: "no-store" }),
        fetch("/api/admin/invites", { cache: "no-store" }),
        fetch("/api/admin/signup-requests", { cache: "no-store" }),
      ]);
      if (!uRes.ok) throw new Error(`users: HTTP ${uRes.status}`);
      if (!iRes.ok) throw new Error(`invites: HTTP ${iRes.status}`);
      if (!sRes.ok) throw new Error(`signup-requests: HTTP ${sRes.status}`);
      const uData = await uRes.json();
      const iData = await iRes.json();
      const sData = await sRes.json();
      setUsers(uData.users ?? []);
      setInvites(iData.invites ?? []);
      setSignupRequests(sData.requests ?? []);
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

  async function approveSignup(request: SignupRequest) {
    setSignupActionId(request.id);
    setError(null);
    try {
      // Send the invite first. If an invite already exists for this email
      // we treat that as success — the prospect still gets promoted to
      // "invited" in the signup_requests table so it disappears from the
      // pending queue.
      const inviteRes = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: request.email }),
      });
      if (!inviteRes.ok) {
        const data = await inviteRes.json().catch(() => ({}));
        const code = data.error;
        if (code !== "invite_pending" && code !== "user_exists") {
          setError(data.message ?? code ?? `invite failed: HTTP ${inviteRes.status}`);
          return;
        }
      }
      const patchRes = await fetch(`/api/admin/signup-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "invited" }),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}));
        setError(data.message ?? data.error ?? `mark invited failed: HTTP ${patchRes.status}`);
        return;
      }
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "approve_failed");
    } finally {
      setSignupActionId(null);
    }
  }

  async function rejectSignup(request: SignupRequest) {
    setSignupActionId(request.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/signup-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? data.error ?? `reject failed: HTTP ${res.status}`);
        return;
      }
      await fetchAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "reject_failed");
    } finally {
      setSignupActionId(null);
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
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>
            LONGBOARD.AI
          </div>
          <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>
            Admin
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <a href="/admin/essays" style={subNavBtn}>Essays →</a>
          <a href="/admin/audit" style={subNavBtn}>Audit Log →</a>
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
      <SectionHeader
        title="Users"
        right={loading ? "loading…" : `${users.length} total`}
        action={
          <button onClick={() => setBulkTagOpen(true)} style={smallBtn("var(--accent)")}>
            BULK TAG
          </button>
        }
      />
      <div style={tableWrap}>
        <table style={tableStyle}>
          <thead>
            <tr style={{ background: "var(--bg)" }}>
              {["Email", "Role", "Tags", "Created", "Last Sign In", ""].map((h) => (
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
                  <td style={tdStyle}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                      {u.tags.length === 0 ? (
                        <span style={{ color: "var(--text-secondary)", fontSize: 11 }}>—</span>
                      ) : (
                        u.tags.map((t) => <TagChip key={t} tag={t} />)
                      )}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{fmtTime(u.created_at)}</td>
                  <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{fmtTime(u.last_sign_in_at)}</td>
                  <td style={{ ...tdStyle, textAlign: "right" }}>
                    <div style={{ display: "inline-flex", gap: 6 }}>
                      <button
                        onClick={() => setManageTagsUser(u)}
                        style={smallBtn("var(--text-secondary)")}
                      >
                        TAGS
                      </button>
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
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && users.length === 0 && (
              <tr><td colSpan={6} style={{ ...tdStyle, color: "var(--text-secondary)", textAlign: "center", padding: 24 }}>No users yet.</td></tr>
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

      {/* ── Signup Requests ── */}
      <div style={{ marginTop: 40 }}>
        <SectionHeader
          title="Signup Requests"
          right={loading ? "loading…" : `${signupRequests.filter((r) => r.status === "pending").length} pending · ${signupRequests.length} total`}
        />
        <div style={tableWrap}>
          <table style={tableStyle}>
            <thead>
              <tr style={{ background: "var(--bg)" }}>
                {["Email", "Message", "Source IP", "Submitted", "Status", ""].map((h) => (
                  <th key={h} style={thStyle}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {signupRequests.map((r) => {
                const working = signupActionId === r.id;
                const canAct = r.status === "pending";
                return (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={tdStyle}>{r.email}</td>
                    <td style={{ ...tdStyle, color: "var(--text-secondary)", maxWidth: 320, whiteSpace: "normal", wordBreak: "break-word" }}>
                      {r.message || "—"}
                    </td>
                    <td style={{ ...tdStyle, color: "var(--text-secondary)", fontSize: 11 }}>
                      {r.source_ip ?? "—"}
                    </td>
                    <td style={{ ...tdStyle, color: "var(--text-secondary)" }}>{fmtTime(r.created_at)}</td>
                    <td style={tdStyle}><SignupStatusPill status={r.status} /></td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      {canAct && (
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <button
                            disabled={working}
                            onClick={() => approveSignup(r)}
                            style={{ ...smallBtn("var(--accent)"), opacity: working ? 0.6 : 1, cursor: working ? "wait" : "pointer" }}
                          >
                            {working ? "…" : "APPROVE"}
                          </button>
                          <button
                            disabled={working}
                            onClick={() => rejectSignup(r)}
                            style={{ ...smallBtn("var(--danger)"), opacity: working ? 0.6 : 1, cursor: working ? "wait" : "pointer" }}
                          >
                            REJECT
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!loading && signupRequests.length === 0 && (
                <tr><td colSpan={6} style={{ ...tdStyle, color: "var(--text-secondary)", textAlign: "center", padding: 24 }}>No requests yet.</td></tr>
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

      {manageTagsUser && (
        <TagsManageModal
          // Re-resolve from the live `users` array on every render so
          // the modal's chip list updates automatically after a fetchAll
          // refresh — without needing to close + reopen.
          user={users.find((u) => u.id === manageTagsUser.id) ?? manageTagsUser}
          onClose={() => setManageTagsUser(null)}
          onChanged={async () => { await fetchAll(); }}
          onError={(msg) => setError(msg)}
        />
      )}

      {bulkTagOpen && (
        <BulkTagModal
          onClose={() => setBulkTagOpen(false)}
          onApplied={async () => { await fetchAll(); }}
        />
      )}
    </div>
  );
}

/* ── Presentation helpers ── */

function SectionHeader({ title, right, action }: { title: string; right?: string; action?: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      marginBottom: 14, paddingBottom: 8, borderBottom: "1px solid var(--border)",
    }}>
      <div style={{ fontSize: 14, color: "var(--text-secondary)", letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 600 }}>
        {title}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        {right && <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>{right}</div>}
        {action}
      </div>
    </div>
  );
}

function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  const isBoardroomCohort = tag.startsWith("boardroom-cohort-");
  const color = isBoardroomCohort ? "var(--accent)" : "var(--text-secondary)";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 10, padding: "2px 8px", border: `1px solid ${color}`,
      color, borderRadius: 10, fontWeight: 500, fontFamily: font,
      letterSpacing: 0.5,
    }}>
      {tag}
      {onRemove && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${tag}`}
          style={{
            background: "none", border: "none", color, cursor: "pointer",
            padding: 0, marginLeft: 2, fontSize: 12, lineHeight: 1, fontWeight: 700,
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

function TagsManageModal({
  user, onClose, onChanged, onError,
}: {
  user: AdminUser;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [working, setWorking] = useState(false);

  async function add() {
    const tag = draft.trim();
    if (!tag) return;
    setWorking(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      setDraft("");
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "add_tag_failed");
    } finally {
      setWorking(false);
    }
  }

  async function remove(tag: string) {
    setWorking(true);
    try {
      const res = await fetch(
        `/api/admin/users/${user.id}/tags/${encodeURIComponent(tag)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "remove_tag_failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
        padding: 24, minWidth: 420, maxWidth: 540, fontFamily: font,
      }}>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
          Manage tags
        </div>
        <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 500, marginBottom: 16 }}>
          {user.email}
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8, letterSpacing: 1 }}>
            CURRENT TAGS
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 28 }}>
            {user.tags.length === 0 ? (
              <span style={{ color: "var(--text-secondary)", fontSize: 12 }}>(none)</span>
            ) : (
              user.tags.map((t) => (
                <TagChip key={t} tag={t} onRemove={() => remove(t)} />
              ))
            )}
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8, letterSpacing: 1 }}>
            ADD TAG
          </div>
          <form
            onSubmit={(e) => { e.preventDefault(); add(); }}
            style={{ display: "flex", gap: 8 }}
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="boardroom-cohort-1"
              autoFocus
              style={{
                flex: 1, background: "var(--bg)", border: "1px solid var(--border)",
                padding: "8px 10px", borderRadius: 3, color: "var(--text-primary)",
                fontFamily: font, fontSize: 13, outline: "none",
              }}
            />
            <button
              type="submit"
              disabled={working || !draft.trim()}
              style={{
                background: "transparent", border: "1px solid var(--accent)", color: "var(--accent)",
                padding: "8px 14px", borderRadius: 3, fontFamily: font, fontSize: 11,
                fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase",
                cursor: working ? "wait" : "pointer", opacity: working || !draft.trim() ? 0.6 : 1,
              }}
            >
              ADD
            </button>
          </form>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)",
              padding: "8px 16px", borderRadius: 3, fontFamily: font, fontSize: 11,
              fontWeight: 700, letterSpacing: 1.5, cursor: "pointer", textTransform: "uppercase",
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkTagModal({ onClose, onApplied }: { onClose: () => void; onApplied: () => Promise<void> }) {
  const [tag, setTag] = useState("");
  const [emailsRaw, setEmailsRaw] = useState("");
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<BulkTagResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setResult(null);
    const t = tag.trim();
    const emails = emailsRaw.split(/\s+/).map((e) => e.trim()).filter(Boolean);
    if (!t) { setError("Tag is required."); return; }
    if (emails.length === 0) { setError("Paste at least one email."); return; }

    setWorking(true);
    try {
      const res = await fetch("/api/admin/users/bulk-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: t, emails }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      setResult(data as BulkTagResult);
      await onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : "bulk_tag_failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
    >
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6,
        padding: 24, minWidth: 480, maxWidth: 620, fontFamily: font,
      }}>
        <div style={{ fontSize: 11, color: "var(--text-secondary)", letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
          Bulk tag
        </div>
        <div style={{ fontSize: 16, color: "var(--text-primary)", fontWeight: 500, marginBottom: 16 }}>
          Apply a tag to many users at once
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6, letterSpacing: 1 }}>
            TAG
          </div>
          <input
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="boardroom-cohort-1"
            disabled={working}
            style={{
              width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
              padding: "8px 10px", borderRadius: 3, color: "var(--text-primary)",
              fontFamily: font, fontSize: 13, outline: "none",
            }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 6, letterSpacing: 1 }}>
            EMAILS (one per line)
          </div>
          <textarea
            value={emailsRaw}
            onChange={(e) => setEmailsRaw(e.target.value)}
            placeholder={"member1@example.com\nmember2@example.com\n…"}
            disabled={working}
            rows={8}
            style={{
              width: "100%", background: "var(--bg)", border: "1px solid var(--border)",
              padding: "8px 10px", borderRadius: 3, color: "var(--text-primary)",
              fontFamily: font, fontSize: 13, outline: "none", resize: "vertical",
            }}
          />
        </div>

        {error && (
          <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>
        )}

        {result && (
          <div style={{
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 4,
            padding: "10px 14px", marginBottom: 16, fontSize: 12,
          }}>
            <div style={{ marginBottom: 6 }}>
              <span style={{ color: "var(--accent)" }}>{result.matched.length} tagged</span>
              {result.unmatched.length > 0 && (
                <span style={{ color: "var(--danger)", marginLeft: 12 }}>
                  {result.unmatched.length} not found
                </span>
              )}
            </div>
            {result.unmatched.length > 0 && (
              <details>
                <summary style={{ cursor: "pointer", color: "var(--text-secondary)" }}>
                  Show unmatched
                </summary>
                <pre style={{
                  marginTop: 8, fontSize: 11, color: "var(--text-secondary)",
                  whiteSpace: "pre-wrap", wordBreak: "break-all",
                }}>
                  {result.unmatched.join("\n")}
                </pre>
              </details>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            onClick={onClose}
            disabled={working}
            style={{
              background: "transparent", color: "var(--text-primary)", border: "1px solid var(--border)",
              padding: "10px 18px", borderRadius: 3, fontFamily: font, fontSize: 12,
              fontWeight: 700, letterSpacing: 1.5, cursor: working ? "wait" : "pointer",
              textTransform: "uppercase",
            }}
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={submit}
              disabled={working || !tag.trim() || !emailsRaw.trim()}
              style={{
                background: "var(--accent)", color: "var(--bg)", border: "none",
                padding: "10px 18px", borderRadius: 3, fontFamily: font, fontSize: 12,
                fontWeight: 700, letterSpacing: 1.5,
                cursor: working ? "wait" : "pointer",
                opacity: working || !tag.trim() || !emailsRaw.trim() ? 0.6 : 1,
                textTransform: "uppercase",
              }}
            >
              {working ? "Applying…" : "Apply tag"}
            </button>
          )}
        </div>
      </div>
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

function SignupStatusPill({ status }: { status: "pending" | "invited" | "rejected" | "duplicate" }) {
  const color =
    status === "invited" ? "var(--accent)" :
    status === "rejected" ? "var(--danger)" :
    status === "duplicate" ? "var(--warning)" :
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

const subNavBtn: React.CSSProperties = {
  fontSize: 11, padding: "6px 14px",
  color: "var(--text-secondary)", border: "1px solid var(--border)",
  borderRadius: 3, textDecoration: "none", letterSpacing: 1,
  textTransform: "uppercase", fontFamily: font,
};

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
