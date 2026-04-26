"use client";

import React, { useState } from "react";
import { SectionHeader, Card, Textarea, BtnAccent } from "@/components/boardroom/shared";

export type WelcomeRow = {
  cohort: string;
  body_markdown: string;
  updated_by: string | null;
  updated_at: string;
};

export default function WelcomeSection({
  cohort, initialRow, onError,
}: {
  cohort: string;
  initialRow: WelcomeRow | null;
  onError: (msg: string) => void;
}) {
  const [draft, setDraft] = useState(initialRow?.body_markdown ?? "");
  const [savedBody, setSavedBody] = useState(initialRow?.body_markdown ?? "");
  const [saving, setSaving] = useState(false);

  const dirty = draft !== savedBody;

  async function save() {
    onError("");
    setSaving(true);
    try {
      const res = await fetch("/api/admin/boardroom/welcome", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cohort, body_markdown: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      setSavedBody(draft);
    } catch (e) {
      onError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Welcome"
        right={initialRow ? "Singleton" : "Not yet published"}
      />
      <Card>
        <Textarea
          value={draft}
          onChange={setDraft}
          rows={8}
          disabled={saving}
          placeholder={"Welcome to the Boardroom…\n\nPlain text or markdown — rendered with line breaks preserved on /boardroom."}
        />
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10,
        }}>
          <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
            {dirty ? "Unsaved changes" : initialRow ? "Saved" : "Not yet published"}
          </div>
          <BtnAccent onClick={save} disabled={saving || !dirty || !draft.trim()}>
            {saving ? "Saving…" : "Save welcome"}
          </BtnAccent>
        </div>
      </Card>
    </div>
  );
}
