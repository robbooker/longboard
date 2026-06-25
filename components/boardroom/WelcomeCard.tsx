"use client";

import React, { useState } from "react";
import { CardHeader, BtnAccent, BtnGhost, Textarea } from "@/components/boardroom/shared";

const font = "var(--font-labels)";

export default function WelcomeCard({
  cohort, isAdmin, markdown,
}: {
  cohort: string;
  isAdmin: boolean;
  markdown: string | null;
}) {
  const [savedBody, setSavedBody] = useState<string | null>(markdown);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(savedBody ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setError(null);
    setDraft(savedBody ?? "");
    setEditing(true);
  }

  async function save() {
    setError(null);
    if (!draft.trim()) {
      setError("Welcome body is required");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/boardroom/welcome", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort, body_markdown: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setSavedBody(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 6, padding: "20px 22px", fontFamily: font,
    }}>
      <CardHeader
        title="Welcome"
        isAdmin={isAdmin}
        editing={editing}
        onToggle={() => editing ? setEditing(false) : startEdit()}
      />

      {error && (
        <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 10 }}>{error}</div>
      )}

      {editing ? (
        <>
          <Textarea
            value={draft}
            onChange={setDraft}
            rows={8}
            disabled={busy}
            placeholder={"Welcome to the Boardroom…\n\nPlain text or markdown — line breaks are preserved."}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <BtnAccent onClick={save} disabled={busy || !draft.trim()}>
              {busy ? "Saving…" : "Save"}
            </BtnAccent>
            <BtnGhost onClick={() => { setEditing(false); setError(null); }} disabled={busy}>
              Cancel
            </BtnGhost>
          </div>
        </>
      ) : savedBody ? (
        <div style={{
          fontSize: 14, color: "var(--text-primary)", lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}>
          {savedBody}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
          Welcome message hasn&apos;t been published yet.
        </div>
      )}
    </div>
  );
}
