"use client";

import { useEffect, useId, useState } from "react";
import styles from "./ChatApiTokens.module.css";

// CHAT-API: make, copy and revoke personal API tokens. A new token is shown once.
type Token = { id: string; label: string; hint: string; createdAt: string; lastUsedAt: string | null };
const when = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "Never";

export default function ChatApiTokens() {
  const [state, setState] = useState<"loading" | "ready" | "no_access" | "failed">("loading");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<{ token: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const labelId = useId();

  useEffect(() => {
    let live = true;
    fetch("/api/chat/api-tokens", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: { access: boolean; tokens: Token[] }) => {
        if (!live) return;
        setTokens(data.tokens);
        setState(data.access ? "ready" : "no_access");
      })
      .catch(() => live && setState("failed"));
    return () => {
      live = false;
    };
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const r = await fetch("/api/chat/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      const data = await r.json().catch(() => ({}));
      // 400, 403 and 409 carry a message written for people; anything else gets the general one.
      if (!r.ok)
        throw new Error(
          [400, 403, 409].includes(r.status) && typeof data.error === "string"
            ? data.error
            : "Couldn't make a token. Try again.",
        );
      setTokens((list) => [data.details as Token, ...list]);
      setFresh({ token: data.token, label: data.details.label });
      setLabel("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't make a token. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(token: Token) {
    if (busy || !window.confirm(`Revoke “${token.label}”? Programs using it stop working straight away.`)) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/chat/api-tokens", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: token.id }),
      });
      if (!r.ok && r.status !== 404) throw new Error();
      setTokens((list) => list.filter((t) => t.id !== token.id));
      if (fresh && token.hint === fresh.token.slice(-4)) setFresh(null);
    } catch {
      setError("Couldn't revoke that token. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.token);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (state === "loading") return <p className={styles.muted}>Loading your tokens…</p>;
  if (state === "failed") return <p className={styles.error}>Couldn&apos;t load your tokens. Refresh to try again.</p>;
  if (state === "no_access")
    return (
      <p className={styles.notice}>
        Developer access is invite-only for now. Ask Rob if you&apos;d like to build something with chat.
      </p>
    );
  return (
    <div className={styles.tokens}>
      {fresh && (
        <div className={styles.fresh} role="status">
          <p>
            <strong>Copy your new token for “{fresh.label}” now.</strong> It won&apos;t be shown again.
          </p>
          <code className={styles.secret}>{fresh.token}</code>
          <div className={styles.actions}>
            <button type="button" onClick={copy}>
              {copied ? "Copied" : "Copy token"}
            </button>
            <button type="button" onClick={() => setFresh(null)}>
              Done
            </button>
          </div>
        </div>
      )}
      <form className={styles.create} onSubmit={create}>
        <label htmlFor={labelId}>Token name</label>
        <div className={styles.row}>
          <input
            id={labelId}
            value={label}
            maxLength={60}
            placeholder="e.g. Trading desk bot"
            onChange={(e) => setLabel(e.target.value)}
          />
          <button type="submit" disabled={busy || !label.trim() || tokens.length >= 5}>
            Create token
          </button>
        </div>
        <p className={styles.muted}>Up to 5 active tokens. Each one can do anything you can do in chat.</p>
      </form>
      <p className={styles.error} role="alert">
        {error}
      </p>
      {tokens.length === 0 ? (
        <p className={styles.muted}>No tokens yet.</p>
      ) : (
        <ul className={styles.list}>
          {tokens.map((t) => (
            <li key={t.id}>
              <div>
                <strong>{t.label}</strong>
                <span className={styles.muted}>
                  lbc_…{t.hint} · made {when(t.createdAt)} · last used {when(t.lastUsedAt)}
                </span>
              </div>
              <button type="button" onClick={() => revoke(t)} disabled={busy}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
