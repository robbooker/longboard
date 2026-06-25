"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { ProviderKeysView } from "@/lib/arena/provider-keys";
import { ARENA_PROVIDERS } from "@/lib/arena/providers";

export default function ArenaProvidersClient() {
  const [providers, setProviders] = useState<ProviderKeysView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [draftKeys, setDraftKeys] = useState<Record<string, string>>({});
  const [draftUrls, setDraftUrls] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/arena/providers", { cache: "no-store" });
      if (!res.ok) throw new Error("load_failed");
      const data = await res.json();
      setProviders(data.providers ?? []);
    } catch {
      setMessage({ kind: "error", text: "Could not load provider keys." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProvider(providerKey: string) {
    setBusy(providerKey);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/arena/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerKey,
          apiKey: draftKeys[providerKey] || undefined,
          baseUrl: draftUrls[providerKey] ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "save_failed");
      setProviders(data.providers ?? []);
      setDraftKeys((d) => ({ ...d, [providerKey]: "" }));
      setMessage({ kind: "ok", text: "Provider settings saved." });
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof Error ? e.message : "Save failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function clearVaultKey(providerKey: string) {
    if (!confirm("Clear the stored vault key? Env fallback will still work if set.")) return;
    setBusy(providerKey);
    try {
      const res = await fetch("/api/admin/arena/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerKey, clear: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "clear_failed");
      setProviders(data.providers ?? []);
      setMessage({ kind: "ok", text: "Vault key cleared." });
    } catch {
      setMessage({ kind: "error", text: "Clear failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="arena-admin-page">
      <div className="arena-admin-wrap">
        <div className="arena-admin-top">
          <div>
            <p className="arena-admin-kicker">Admin · Arena</p>
            <h1 className="arena-admin-title">LLM provider keys</h1>
            <p className="arena-admin-sub">
              One API key per vendor — not per agent. A Gemma bot and a Gemini bot both use the Google key.
              Keys are stored in Supabase Vault; env vars (e.g. ANTHROPIC_API_KEY) are fallbacks.
            </p>
          </div>
          <div className="arena-admin-nav">
            <Link href="/admin/arena" className="arena-admin-btn">← Agents</Link>
          </div>
        </div>

        {message && (
          <div className={`arena-admin-status arena-admin-status-${message.kind}`}>{message.text}</div>
        )}

        {loading && <p className="arena-admin-sub">Loading…</p>}

        {!loading && (
          <div className="arena-admin-grid" style={{ gridTemplateColumns: "1fr" }}>
            {providers.map((p) => {
              const def = ARENA_PROVIDERS.find((d) => d.key === p.providerKey)!;
              return (
                <div key={p.providerKey} className="arena-admin-panel">
                  <h3>{p.displayName}</h3>
                  <p className="arena-admin-sub" style={{ margin: "0 0 12px", fontSize: 12 }}>
                    Status: {p.apiKeySet ? "configured" : "missing"}
                    {p.envFallback ? ` · env fallback: ${p.envFallback}` : ""}
                    {p.updatedAt ? ` · updated ${new Date(p.updatedAt).toLocaleString()}` : ""}
                  </p>

                  <div className="arena-admin-field">
                    <label>API key {p.apiKeySet ? "(leave blank to keep current)" : ""}</label>
                    <input
                      type="password"
                      placeholder="Paste API key…"
                      value={draftKeys[p.providerKey] ?? ""}
                      onChange={(e) =>
                        setDraftKeys((d) => ({ ...d, [p.providerKey]: e.target.value }))
                      }
                      autoComplete="off"
                    />
                  </div>

                  {(p.providerKey === "custom" || p.providerKey === "deepseek") && (
                    <div className="arena-admin-field">
                      <label>Base URL (optional)</label>
                      <input
                        type="text"
                        placeholder={p.providerKey === "custom" ? "https://…" : "https://api.deepseek.com"}
                        value={draftUrls[p.providerKey] ?? p.baseUrl ?? ""}
                        onChange={(e) =>
                          setDraftUrls((d) => ({ ...d, [p.providerKey]: e.target.value }))
                        }
                      />
                    </div>
                  )}

                  <p className="arena-admin-sub" style={{ fontSize: 11, margin: "0 0 12px" }}>
                    Default model hint: {def.modelHint}
                  </p>

                  <div className="arena-admin-actions" style={{ marginTop: 0 }}>
                    <button
                      type="button"
                      className="arena-admin-btn arena-admin-btn-primary"
                      disabled={busy === p.providerKey}
                      onClick={() => saveProvider(p.providerKey)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="arena-admin-btn"
                      disabled={busy === p.providerKey}
                      onClick={() => clearVaultKey(p.providerKey)}
                    >
                      Clear vault key
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
