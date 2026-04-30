"use client";

import React, { useState } from "react";
import {
  DEFAULT_CLOSING_1,
  DEFAULT_CLOSING_2,
  DEFAULT_SUBJECT,
  type MorningEmailStock,
  type QaMessage,
} from "@/lib/morning-email/types";

const font = "var(--font-labels)";

export default function MorningEmailClient() {
  const [subject, setSubject] = useState<string>(DEFAULT_SUBJECT);
  const [closing1, setClosing1] = useState<string>(DEFAULT_CLOSING_1);
  const [closing2, setClosing2] = useState<string>(DEFAULT_CLOSING_2);
  const [stocks] = useState<MorningEmailStock[]>([]);
  const [qa] = useState<QaMessage[]>([]);

  const tooltip = "Wired in a later commit.";

  return (
    <div style={{ fontFamily: font, color: "var(--text-primary)", padding: "32px 24px", maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 3, textTransform: "uppercase", marginBottom: 6 }}>
            LONGBOARD.AI
          </div>
          <div style={{ fontSize: 22, color: "var(--accent)", fontWeight: 500, letterSpacing: 1 }}>
            Morning Email
          </div>
        </div>
        <a href="/admin" style={backBtn}>← Admin</a>
      </div>

      <div style={infoBanner}>
        <div style={{ fontSize: 11, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6, color: "var(--text-secondary)" }}>
          Workflow
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          Scan Polygon → Research Sources → Review/Edit → Generate Preview → Copy / Download HTML.
          Generated emails are archived to <code>morning_email_archive</code>. No send, no upload.
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
        <button style={ctrlBtn} disabled title={tooltip}>SCAN POLYGON</button>
        <button style={ctrlBtn} disabled title={tooltip}>RESEARCH SOURCES</button>
        <button style={ctrlBtn} disabled title={tooltip}>GENERATE PREVIEW</button>
        <button style={ctrlBtn} disabled title={tooltip}>COPY HTML</button>
        <button style={ctrlBtn} disabled title={tooltip}>DOWNLOAD HTML</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20 }}>
        <div>
          <SectionLabel>Subject</SectionLabel>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={inputStyle}
          />

          <SectionLabel>Stocks</SectionLabel>
          {stocks.length === 0 ? (
            <div style={emptyState}>No stocks scanned yet.</div>
          ) : null}

          <SectionLabel>Closing — paragraph 1</SectionLabel>
          <textarea
            value={closing1}
            onChange={(e) => setClosing1(e.target.value)}
            rows={3}
            style={textareaStyle}
          />

          <SectionLabel>Closing — paragraph 2</SectionLabel>
          <textarea
            value={closing2}
            onChange={(e) => setClosing2(e.target.value)}
            rows={2}
            style={textareaStyle}
          />

          {qa.length > 0 ? (
            <>
              <SectionLabel>QA</SectionLabel>
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {qa.map((m, i) => (
                  <li key={i} style={{ color: qaColor(m.level), fontSize: 12, lineHeight: 1.6 }}>
                    {m.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <div>
          <SectionLabel>Preview</SectionLabel>
          <div style={previewFrame}>
            <div style={{ color: "var(--text-secondary)", fontSize: 12, padding: 24, textAlign: "center" }}>
              Generated HTML preview will render here.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, color: "var(--text-secondary)", letterSpacing: 2, textTransform: "uppercase", marginTop: 16, marginBottom: 6 }}>
      {children}
    </div>
  );
}

function qaColor(level: "ok" | "warning" | "error"): string {
  if (level === "error") return "var(--danger)";
  if (level === "warning") return "var(--warning)";
  return "var(--text-secondary)";
}

const backBtn: React.CSSProperties = {
  fontSize: 11, padding: "6px 14px",
  color: "var(--text-secondary)", border: "1px solid var(--border)",
  borderRadius: 3, textDecoration: "none", letterSpacing: 1,
  textTransform: "uppercase", fontFamily: font,
};

const ctrlBtn: React.CSSProperties = {
  fontSize: 11, padding: "8px 14px",
  background: "transparent", color: "var(--text-primary)",
  border: "1px solid var(--border)", borderRadius: 3,
  letterSpacing: 1, textTransform: "uppercase", fontFamily: font,
  cursor: "pointer",
};

const infoBanner: React.CSSProperties = {
  padding: "14px 16px", marginBottom: 20,
  border: "1px solid var(--border)", borderRadius: 4,
  background: "var(--bg-secondary, transparent)",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", fontSize: 13,
  background: "var(--bg-secondary, transparent)", color: "var(--text-primary)",
  border: "1px solid var(--border)", borderRadius: 3, fontFamily: font,
};

const textareaStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", fontSize: 13, lineHeight: 1.5,
  background: "var(--bg-secondary, transparent)", color: "var(--text-primary)",
  border: "1px solid var(--border)", borderRadius: 3, fontFamily: font, resize: "vertical",
};

const emptyState: React.CSSProperties = {
  padding: "20px", textAlign: "center", fontSize: 12,
  color: "var(--text-secondary)", border: "1px dashed var(--border)", borderRadius: 4,
};

const previewFrame: React.CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 4,
  minHeight: 600, background: "var(--bg-secondary, transparent)",
  display: "flex", alignItems: "center", justifyContent: "center",
};
