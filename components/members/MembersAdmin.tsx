"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./MembersAdmin.module.css";

type Entitlement = {
  id: string;
  entitlement_key: string;
  product_key: string | null;
  purchase_id: string | null;
  starts_at: string;
  ends_at: string | null;
  granted_by: "stripe" | "admin";
  note: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  revoked_reason: string | null;
  active: boolean;
};
type Purchase = {
  id: string;
  product_key: string | null;
  kind: string;
  status: string;
  amount: number | null;
  currency: string | null;
  livemode: boolean;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled: boolean;
  refunded: boolean;
  refunded_amount: number;
  stripe_subscription_id: string | null;
  stripe_checkout_session_id: string | null;
  stripe_price_id: string | null;
  created_at: string;
};
type Member = {
  id: string;
  email: string;
  name: string | null;
  stripe_customer_id: string | null;
  chat_account_id: string | null;
  created_at: string;
  purchases: Purchase[];
  entitlements: Entitlement[];
  activeKeys: string[];
};

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const money = (amount: number | null, currency: string | null) =>
  amount === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: (currency ?? "usd").toUpperCase() }).format(amount / 100);

/** #384 admin: search members by email, see purchases and access, grant or revoke by hand. */
export default function MembersAdmin() {
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [grant, setGrant] = useState({ email: "", key: "", ends_at: "", note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q: string) => {
    setError(null);
    const response = await fetch(`/api/admin/members?q=${encodeURIComponent(q)}`, { cache: "no-store" }).catch(() => null);
    const body = await response?.json().catch(() => null);
    if (!response?.ok || !body) return setError("Members couldn't load. Try again.");
    setMembers(body.members);
    setKeys(body.keys);
    setGrant((g) => (g.key ? g : { ...g, key: body.keys[0] ?? "" }));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(query), 250);
    return () => clearTimeout(timer);
  }, [query, load]);

  const send = async (method: "POST" | "PATCH", body: unknown) => {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/admin/members/entitlements", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const result = await response?.json().catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      setError(`That didn't work (${result?.error ?? "network"}).`);
      return false;
    }
    await load(query);
    return true;
  };

  const revoke = (row: Entitlement, email: string) => {
    if (!window.confirm(`Revoke ${row.entitlement_key} for ${email}?`)) return;
    void send("PATCH", { action: "revoke", id: row.id });
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ADMIN</p>
          <h1>Members</h1>
          <p className={styles.sub}>Everyone who bought something, what they bought, and what it opens.</p>
        </div>
        <input
          className={styles.search}
          type="search"
          placeholder="Search by email"
          aria-label="Search by email"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>

      <form
        className={styles.grant}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await send("POST", { email: grant.email, key: grant.key, ends_at: grant.ends_at || null, note: grant.note || null }))
            setGrant((g) => ({ ...g, email: "", note: "", ends_at: "" }));
        }}
      >
        <strong>Grant access by hand</strong>
        <input aria-label="Email to grant" placeholder="email" type="email" required value={grant.email} onChange={(e) => setGrant({ ...grant, email: e.target.value })} />
        <select aria-label="Entitlement" value={grant.key} onChange={(e) => setGrant({ ...grant, key: e.target.value })}>
          {keys.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
        <input aria-label="Ends on (optional)" type="date" value={grant.ends_at} onChange={(e) => setGrant({ ...grant, ends_at: e.target.value })} />
        <input aria-label="Note" placeholder="note (optional)" value={grant.note} onChange={(e) => setGrant({ ...grant, note: e.target.value })} />
        <button type="submit" disabled={busy || !grant.key}>Grant</button>
      </form>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {members === null ? (
        <p className={styles.empty}>Loading…</p>
      ) : members.length === 0 ? (
        <p className={styles.empty}>No members{query ? ` matching “${query}”` : " yet"}.</p>
      ) : (
        <ul className={styles.list}>
          {members.map((m) => (
            <li key={m.id} className={styles.member} data-member={m.email}>
              <div className={styles.who}>
                <div>
                  <strong>{m.email}</strong>
                  {m.name && <span className={styles.name}>{m.name}</span>}
                </div>
                <div className={styles.badges}>
                  {m.activeKeys.length ? m.activeKeys.map((k) => <span key={k} className={styles.on}>{k}</span>) : <span className={styles.off}>no access</span>}
                  <span className={m.chat_account_id ? styles.linked : styles.off}>{m.chat_account_id ? "chat linked" : "not signed up"}</span>
                </div>
              </div>
              <div className={styles.cols}>
                <section>
                  <h2>Purchases</h2>
                  {m.purchases.length === 0 ? (
                    <p className={styles.none}>None</p>
                  ) : (
                    <table>
                      <thead>
                        <tr><th>Product</th><th>Status</th><th>Amount</th><th>Renews / ends</th><th>Bought</th></tr>
                      </thead>
                      <tbody>
                        {m.purchases.map((p) => (
                          <tr key={p.id}>
                            <td>{p.product_key ?? <em title={p.stripe_price_id ?? ""}>unmapped</em>}{p.livemode ? "" : " (test)"}</td>
                            <td>
                              {p.status}
                              {p.refunded ? " · refunded" : p.refunded_amount ? ` · ${money(p.refunded_amount, p.currency)} refunded` : ""}
                              {p.cancel_at_period_end && !p.canceled ? " · cancels" : ""}
                            </td>
                            <td>{money(p.amount, p.currency)}{p.kind === "subscription" ? "/period" : ""}</td>
                            <td>{day(p.current_period_end)}</td>
                            <td>{day(p.created_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
                <section>
                  <h2>Access</h2>
                  {m.entitlements.length === 0 ? (
                    <p className={styles.none}>None</p>
                  ) : (
                    <table>
                      <thead>
                        <tr><th>Key</th><th>From</th><th>Until</th><th>State</th><th /></tr>
                      </thead>
                      <tbody>
                        {m.entitlements.map((e) => (
                          <tr key={e.id} data-entitlement={e.entitlement_key}>
                            <td>{e.entitlement_key}</td>
                            <td>{e.granted_by === "admin" ? `admin${e.note ? ` · ${e.note}` : ""}` : e.product_key ?? "stripe"}</td>
                            <td>{day(e.ends_at)}</td>
                            <td className={e.active ? styles.activeCell : styles.inactiveCell}>
                              {e.revoked_at ? `revoked (${e.revoked_reason ?? e.revoked_by})` : e.active ? "active" : "ended"}
                            </td>
                            <td>
                              {!e.revoked_at && (
                                <button type="button" className={styles.revoke} disabled={busy} onClick={() => revoke(e, m.email)}>
                                  Revoke
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
