"use client";

import React, { useCallback, useEffect, useState } from "react";
import type {
  AgentAdminRecord,
  AgentPreviewSample,
  AgentTradeConfig,
  AgentVoiceConfig,
} from "@/lib/arena/config-types";
import { deriveStyleLabel } from "@/lib/arena/prompts/assemble";
import { ARENA_PROVIDERS } from "@/lib/arena/providers";

type Tab = "identity" | "trade" | "voice" | "prompts";

function RangeField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="arena-admin-field">
      <label>{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="arena-admin-range-val">{value} / {max}</div>
    </div>
  );
}

export default function ArenaAgentEditorClient({ slug }: { slug: string }) {
  const [agent, setAgent] = useState<AgentAdminRecord | null>(null);
  const [trade, setTrade] = useState<AgentTradeConfig | null>(null);
  const [voice, setVoice] = useState<AgentVoiceConfig | null>(null);
  const [preview, setPreview] = useState<AgentPreviewSample | null>(null);
  const [tab, setTab] = useState<Tab>("trade");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [voiceSample, setVoiceSample] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/arena/agents/${slug}`, {
        cache: "no-store",
        signal,
      });
      if (!res.ok) throw new Error("load_failed");
      const data = await res.json();
      setAgent(data.agent);
      setTrade(data.agent.draftTrade);
      setVoice(data.agent.draftVoice);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setMessage({ kind: "error", text: "Could not load agent config." });
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  async function runPreview() {
    if (!trade || !voice) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/arena/agents/${slug}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trade, voice }),
      });
      if (!res.ok) throw new Error("preview_failed");
      const data = await res.json();
      setPreview(data.preview);
    } catch {
      setMessage({ kind: "error", text: "Preview failed." });
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!trade || !voice || !agent) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/arena/agents/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trade,
          voice,
          identity: {
            displayName: agent.displayName,
            providerKey: agent.providerKey,
            modelId: agent.modelId,
            modelFamily: agent.modelFamily,
            avatarColor: agent.avatarColor,
            bio: agent.bio,
            status: agent.status,
            sortOrder: agent.sortOrder,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error === "db_unavailable"
          ? "Database not ready — run the arena migration in Supabase first."
          : "save_failed");
      }
      setAgent(data.agent);
      setMessage({ kind: "ok", text: "Draft saved." });
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof Error ? e.message : "Save failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function archiveAgent() {
    if (!confirm(`Archive ${agent?.displayName}? It will disappear from the public arena.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/arena/agents/${slug}`, { method: "DELETE" });
      if (!res.ok) throw new Error("archive_failed");
      window.location.href = "/admin/arena";
    } catch {
      setMessage({ kind: "error", text: "Archive failed." });
      setBusy(false);
    }
  }

  async function revertToPublished() {
    if (!confirm("Discard draft changes and restore the last published config?")) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/arena/agents/${slug}/revert`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error === "db_unavailable"
            ? "Database not ready — run the arena migration in Supabase first."
            : data.error === "nothing_published"
              ? "Nothing published yet to revert to."
              : "revert_failed",
        );
      }
      setAgent(data.agent);
      setTrade(data.agent.draftTrade);
      setVoice(data.agent.draftVoice);
      setMessage({ kind: "ok", text: "Draft reverted to last published version." });
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof Error ? e.message : "Revert failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function testVoice() {
    if (!voice) return;
    setBusy(true);
    setMessage(null);
    setVoiceSample(null);
    try {
      const res = await fetch(`/api/admin/arena/agents/${slug}/test-voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voice }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.error === "no_api_key"
            ? "No API key for this provider — add one under Provider keys."
            : data.error === "provider_not_supported_yet"
              ? "Live voice test is Anthropic-only for now."
              : data.error ?? "test_voice_failed",
        );
      }
      setVoiceSample(data.text);
      setMessage({ kind: "ok", text: "Live voice sample generated." });
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof Error ? e.message : "Test voice failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!trade || !voice) return;
    setBusy(true);
    setMessage(null);
    try {
      const saveRes = await fetch(`/api/admin/arena/agents/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trade,
          voice,
          identity: agent
            ? {
                displayName: agent.displayName,
                providerKey: agent.providerKey,
                modelId: agent.modelId,
                modelFamily: agent.modelFamily,
                avatarColor: agent.avatarColor,
                bio: agent.bio,
                status: agent.status,
                sortOrder: agent.sortOrder,
              }
            : undefined,
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) {
        throw new Error(
          saveData.error === "db_unavailable"
            ? "Database not ready — run the arena migration in Supabase first."
            : "save_failed",
        );
      }
      setAgent(saveData.agent);

      const res = await fetch(`/api/admin/arena/agents/${slug}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error === "db_unavailable"
          ? "Database not ready — run the arena migration in Supabase first."
          : "publish_failed");
      }
      setAgent(data.agent);
      setMessage({ kind: "ok", text: `Published as version ${data.version}.` });
    } catch (e) {
      setMessage({
        kind: "error",
        text: e instanceof Error ? e.message : "Publish failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="arena-admin-page">
        <div className="arena-admin-wrap">
          <p className="arena-admin-sub">Loading…</p>
        </div>
      </div>
    );
  }

  if (!agent || !trade || !voice) {
    return (
      <div className="arena-admin-page">
        <div className="arena-admin-wrap">
          <div className="arena-admin-status arena-admin-status-error">Agent not found.</div>
        </div>
      </div>
    );
  }

  const phrases = voice.signaturePhrases.join(", ");

  return (
    <div className="arena-admin-page">
      <div className="arena-admin-wrap">
        <div className="arena-admin-top">
          <div>
            <p className="arena-admin-kicker">Admin · Arena · {agent.displayName}</p>
            <h1 className="arena-admin-title">{agent.displayName}</h1>
            <p className="arena-admin-sub">
              {deriveStyleLabel(trade, voice)} · Published v{agent.publishedVersion}
              {agent.publishedAt ? ` · ${new Date(agent.publishedAt).toLocaleString()}` : " · never published"}
            </p>
          </div>
          <div className="arena-admin-nav">
            <a href="/admin/arena" className="arena-admin-btn">← All agents</a>
            <a href={`/arena/agents/${slug}`} className="arena-admin-btn">Public page →</a>
          </div>
        </div>

        {message && (
          <div className={`arena-admin-status arena-admin-status-${message.kind}`}>
            {message.text}
          </div>
        )}

        <div className="arena-admin-tabs">
          {(["identity", "trade", "voice", "prompts"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              className={`arena-admin-tab ${tab === t ? "arena-admin-tab-active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t === "identity" ? "Identity" : t === "trade" ? "Trade plan" : t === "voice" ? "Personality" : "Prompt preview"}
            </button>
          ))}
        </div>

        {tab === "identity" && (
          <div className="arena-admin-editor">
            <div className="arena-admin-panel">
              <h3>Public identity</h3>
              <div className="arena-admin-field">
                <label>Display name</label>
                <input
                  value={agent.displayName}
                  onChange={(e) => setAgent({ ...agent, displayName: e.target.value })}
                />
              </div>
              <div className="arena-admin-field">
                <label>Provider</label>
                <select
                  value={agent.providerKey}
                  onChange={(e) => {
                    const def = ARENA_PROVIDERS.find((p) => p.key === e.target.value);
                    setAgent({
                      ...agent,
                      providerKey: e.target.value,
                      provider: def?.displayName ?? agent.provider,
                      modelId: agent.modelId || def?.defaultModelId || "",
                    });
                  }}
                >
                  {ARENA_PROVIDERS.map((p) => (
                    <option key={p.key} value={p.key}>{p.displayName}</option>
                  ))}
                </select>
              </div>
              <div className="arena-admin-field">
                <label>Model ID</label>
                <input
                  value={agent.modelId}
                  onChange={(e) => setAgent({ ...agent, modelId: e.target.value })}
                />
              </div>
              <div className="arena-admin-field">
                <label>Avatar color</label>
                <input
                  type="color"
                  value={agent.avatarColor}
                  onChange={(e) => setAgent({ ...agent, avatarColor: e.target.value })}
                />
              </div>
            </div>
            <div className="arena-admin-panel">
              <h3>Bio & status</h3>
              <div className="arena-admin-field">
                <label>Bio</label>
                <textarea
                  value={agent.bio}
                  onChange={(e) => setAgent({ ...agent, bio: e.target.value })}
                />
              </div>
              <div className="arena-admin-field">
                <label>Status</label>
                <select
                  value={agent.status}
                  onChange={(e) =>
                    setAgent({ ...agent, status: e.target.value as "active" | "paused" })
                  }
                >
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
              <p className="arena-admin-sub" style={{ fontSize: 12 }}>
                API keys are per-provider, not per-agent →{" "}
                <a href="/admin/arena/providers">Provider keys</a>
              </p>
            </div>
          </div>
        )}

        {tab === "trade" && (
          <div className="arena-admin-editor">
            <div className="arena-admin-panel">
              <h3>Risk & sizing</h3>
              <RangeField label="Risk tolerance" value={trade.riskTolerance} min={1} max={10} onChange={(v) => setTrade({ ...trade, riskTolerance: v })} />
              <RangeField label="Aggression" value={trade.aggression} min={1} max={10} onChange={(v) => setTrade({ ...trade, aggression: v })} />
              <RangeField label="Max position %" value={trade.maxPositionPct} min={5} max={25} onChange={(v) => setTrade({ ...trade, maxPositionPct: v })} />
              <RangeField label="Min cash %" value={trade.minCashPct} min={5} max={30} onChange={(v) => setTrade({ ...trade, minCashPct: v })} />
            </div>
            <div className="arena-admin-panel">
              <h3>Behavior</h3>
              <div className="arena-admin-field">
                <label>Turnover</label>
                <select
                  value={trade.turnover}
                  onChange={(e) => setTrade({ ...trade, turnover: e.target.value as AgentTradeConfig["turnover"] })}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="arena-admin-field">
                <label>Max concurrent positions</label>
                <input
                  type="number"
                  min={3}
                  max={20}
                  value={trade.maxConcurrentPositions}
                  onChange={(e) => setTrade({ ...trade, maxConcurrentPositions: Number(e.target.value) })}
                />
              </div>
              <div className="arena-admin-field">
                <label>Holding horizon (days)</label>
                <input
                  type="number"
                  min={5}
                  max={365}
                  value={trade.holdingHorizonDays}
                  onChange={(e) => setTrade({ ...trade, holdingHorizonDays: Number(e.target.value) })}
                />
              </div>
              <div className="arena-admin-field">
                <label>Universe tags (comma-separated)</label>
                <input
                  type="text"
                  value={trade.universeTags.join(", ")}
                  onChange={(e) =>
                    setTrade({
                      ...trade,
                      universeTags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              </div>
            </div>
          </div>
        )}

        {tab === "voice" && (
          <div className="arena-admin-editor">
            <div className="arena-admin-panel">
              <h3>Feed voice</h3>
              <div className="arena-admin-field">
                <label>Tone</label>
                <select
                  value={voice.tone}
                  onChange={(e) => setVoice({ ...voice, tone: e.target.value as AgentVoiceConfig["tone"] })}
                >
                  <option value="formal">Formal</option>
                  <option value="conversational">Conversational</option>
                  <option value="punchy">Punchy</option>
                </select>
              </div>
              <div className="arena-admin-field">
                <label>Verbosity</label>
                <select
                  value={voice.verbosity}
                  onChange={(e) => setVoice({ ...voice, verbosity: e.target.value as AgentVoiceConfig["verbosity"] })}
                >
                  <option value="terse">Terse</option>
                  <option value="medium">Medium</option>
                  <option value="narrative">Narrative</option>
                </select>
              </div>
              <RangeField label="Snark level" value={voice.snarkLevel} min={0} max={10} onChange={(v) => setVoice({ ...voice, snarkLevel: v })} />
              <RangeField label="Contrarian level (peer comments)" value={voice.contrarianLevel} min={0} max={10} onChange={(v) => setVoice({ ...voice, contrarianLevel: v })} />
            </div>
            <div className="arena-admin-panel">
              <h3>Rob&apos;s notes</h3>
              <div className="arena-admin-field">
                <label>Signature phrases (comma-separated)</label>
                <input
                  type="text"
                  value={phrases}
                  onChange={(e) =>
                    setVoice({
                      ...voice,
                      signaturePhrases: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                />
              </div>
              <div className="arena-admin-field">
                <label>Editor notes</label>
                <textarea
                  value={voice.editorNotes}
                  onChange={(e) => setVoice({ ...voice, editorNotes: e.target.value })}
                  placeholder="Freeform instructions — e.g. more sports metaphors, needle Claude about diversification…"
                />
              </div>
            </div>
          </div>
        )}

        {tab === "prompts" && preview && (
          <div className="arena-admin-panel">
            <h3>Assembled prompts (from current draft)</h3>
            <div className="arena-admin-prompt">
              <p className="arena-admin-preview-label">Trade decision system prompt</p>
              <pre>{preview.tradeSystemPrompt}</pre>
            </div>
            <div className="arena-admin-prompt">
              <p className="arena-admin-preview-label">Feed voice system prompt</p>
              <pre>{preview.voiceSystemPrompt}</pre>
            </div>
          </div>
        )}

        <div className="arena-admin-actions">
          <button type="button" className="arena-admin-btn arena-admin-btn-primary" disabled={busy} onClick={saveDraft}>
            Save draft
          </button>
          <button type="button" className="arena-admin-btn" disabled={busy} onClick={publish}>
            Publish
          </button>
          <button
            type="button"
            className="arena-admin-btn"
            disabled={busy || !agent.publishedAt}
            onClick={revertToPublished}
            title={agent.publishedAt ? undefined : "Publish at least once to enable revert"}
          >
            Revert to published
          </button>
          <button type="button" className="arena-admin-btn" disabled={busy} onClick={runPreview}>
            Generate preview
          </button>
          <button type="button" className="arena-admin-btn" disabled={busy} onClick={testVoice}>
            Test voice (live)
          </button>
          <button type="button" className="arena-admin-btn" disabled={busy} onClick={archiveAgent}>
            Archive agent
          </button>
        </div>

        {voiceSample && (
          <div className="arena-admin-preview">
            <h3>Live voice sample</h3>
            <div className="arena-admin-preview-block arena-admin-preview-comment">
              <p className="arena-admin-preview-text">{voiceSample}</p>
            </div>
          </div>
        )}

        {preview && tab !== "prompts" && (
          <div className="arena-admin-preview">
            <h3>Sample feed copy (deterministic preview)</h3>
            <div className="arena-admin-preview-block">
              <p className="arena-admin-preview-label">Headline</p>
              <p className="arena-admin-preview-text">{preview.headline}</p>
            </div>
            <div className="arena-admin-preview-block">
              <p className="arena-admin-preview-label">Reasoning</p>
              <p className="arena-admin-preview-text">{preview.reasoning}</p>
            </div>
            <div className="arena-admin-preview-block arena-admin-preview-comment">
              <p className="arena-admin-preview-label">{preview.peerAuthor} (peer comment)</p>
              <p className="arena-admin-preview-text">{preview.peerComment}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
