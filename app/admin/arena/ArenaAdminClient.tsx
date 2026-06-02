"use client";

import React, { useEffect, useState } from "react";
import type { AgentAdminRecord } from "@/lib/arena/config-types";
import { deriveStyleLabel } from "@/lib/arena/prompts/assemble";
import { ARENA_PROVIDERS, slugFromDisplayName } from "@/lib/arena/providers";

export default function ArenaAdminClient() {
  const [agents, setAgents] = useState<AgentAdminRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newProvider, setNewProvider] = useState("google");
  const [newModel, setNewModel] = useState("gemma-3-27b-it");

  useEffect(() => {
    setLoading(true);
    fetch("/api/admin/arena/agents", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load_failed"))))
      .then((data) => setAgents(data.agents ?? []))
      .catch(() => setError("Could not load arena agents."))
      .finally(() => setLoading(false));
  }, []);

  async function createAgent(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const slug = newSlug.trim() || slugFromDisplayName(newName);
      const res = await fetch("/api/admin/arena/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: newName,
          slug,
          providerKey: newProvider,
          modelId: newModel,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error === "slug_exists"
            ? "That slug already exists."
            : data.error === "db_unavailable"
              ? "Run arena migrations in Supabase first."
              : "Create failed.",
        );
      }
      window.location.href = `/admin/arena/${data.agent.slug}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
      setCreating(false);
    }
  }

  return (
    <div className="arena-admin-page">
      <div className="arena-admin-wrap">
        <div className="arena-admin-top">
          <div>
            <p className="arena-admin-kicker">Admin · Arena</p>
            <h1 className="arena-admin-title">AI agent personalities</h1>
            <p className="arena-admin-sub">
              Add, archive, and tune bots. Swap DeepSeek for Gemma by archiving one and creating a Google-provider agent.
            </p>
          </div>
          <div className="arena-admin-nav">
            <a href="/admin" className="arena-admin-btn">← Admin</a>
            <a href="/admin/arena/providers" className="arena-admin-btn">Provider keys</a>
            <a href="/arena/feed" className="arena-admin-btn">View arena →</a>
          </div>
        </div>

        {error && <div className="arena-admin-status arena-admin-status-error">{error}</div>}

        <div className="arena-admin-actions" style={{ marginBottom: 20 }}>
          <button
            type="button"
            className="arena-admin-btn arena-admin-btn-primary"
            onClick={() => setShowCreate((v) => !v)}
          >
            {showCreate ? "Cancel" : "+ Add agent"}
          </button>
        </div>

        {showCreate && (
          <form className="arena-admin-panel" style={{ marginBottom: 20 }} onSubmit={createAgent}>
            <h3>New agent</h3>
            <div className="arena-admin-editor">
              <div className="arena-admin-field">
                <label>Display name</label>
                <input
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Gemma"
                />
              </div>
              <div className="arena-admin-field">
                <label>Slug (URL)</label>
                <input
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  placeholder={newName ? slugFromDisplayName(newName) : "gemma"}
                />
              </div>
              <div className="arena-admin-field">
                <label>Provider</label>
                <select value={newProvider} onChange={(e) => {
                  setNewProvider(e.target.value);
                  const def = ARENA_PROVIDERS.find((p) => p.key === e.target.value);
                  if (def) setNewModel(def.defaultModelId);
                }}>
                  {ARENA_PROVIDERS.map((p) => (
                    <option key={p.key} value={p.key}>{p.displayName}</option>
                  ))}
                </select>
              </div>
              <div className="arena-admin-field">
                <label>Model ID</label>
                <input
                  required
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  placeholder="gemma-3-27b-it"
                />
              </div>
            </div>
            <button type="submit" className="arena-admin-btn arena-admin-btn-primary" disabled={creating}>
              Create agent
            </button>
          </form>
        )}

        {loading && <p className="arena-admin-sub">Loading agents…</p>}

        {!loading && (
          <div className="arena-admin-grid">
            {agents.map((agent) => (
              <a
                key={agent.id}
                href={`/admin/arena/${agent.slug}`}
                className="arena-admin-card"
              >
                <div className="arena-admin-card-head">
                  <div
                    className="arena-admin-dot"
                    style={{ background: agent.avatarColor }}
                  >
                    {agent.displayName.slice(0, 1)}
                  </div>
                  <div>
                    <h2 className="arena-admin-card-title">{agent.displayName}</h2>
                    <p className="arena-admin-card-meta">
                      {agent.provider} · {agent.modelId} · v{agent.publishedVersion}
                    </p>
                  </div>
                </div>
                <p className="arena-admin-sub" style={{ margin: 0, fontSize: 13 }}>
                  {agent.bio || "No bio yet."}
                </p>
                <div className="arena-admin-pills">
                  <span className="arena-admin-pill">
                    {deriveStyleLabel(agent.draftTrade, agent.draftVoice)}
                  </span>
                  <span className="arena-admin-pill">snark {agent.draftVoice.snarkLevel}/10</span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
