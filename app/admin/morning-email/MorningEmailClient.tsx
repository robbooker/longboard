"use client";

import React, { useCallback, useState } from "react";
import {
  DEFAULT_CLOSING_1,
  DEFAULT_CLOSING_2,
  DEFAULT_SUBJECT,
  type Confidence,
  type MorningEmailStock,
  type QaMessage,
} from "@/lib/morning-email/types";

const font = "var(--font-labels)";

type ScanResponse = {
  stocks: MorningEmailStock[];
  qa: QaMessage[];
  live: boolean;
};

type ResearchResponse = {
  stocks: MorningEmailStock[];
  qa: QaMessage[];
};

export default function MorningEmailClient() {
  const [subject, setSubject] = useState<string>(DEFAULT_SUBJECT);
  const [closing1, setClosing1] = useState<string>(DEFAULT_CLOSING_1);
  const [closing2, setClosing2] = useState<string>(DEFAULT_CLOSING_2);
  const [forceTickers, setForceTickers] = useState<string>("");
  const [stocks, setStocks] = useState<MorningEmailStock[]>([]);
  const [qa, setQa] = useState<QaMessage[]>([]);
  const [live, setLive] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState<boolean>(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [researching, setResearching] = useState<boolean>(false);
  const [researchError, setResearchError] = useState<string | null>(null);

  const tooltip = "Wired in a later commit.";

  const onScan = useCallback(async () => {
    setScanning(true);
    setScanError(null);
    try {
      const res = await fetch("/api/admin/morning-email/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ forceTickers: forceTickers.trim() || undefined }),
        cache: "no-store",
      });
      const data = (await res.json()) as ScanResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setStocks(data.stocks ?? []);
      setQa(data.qa ?? []);
      setLive(Boolean(data.live));
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }, [forceTickers]);

  const onResearch = useCallback(async () => {
    if (stocks.length === 0) return;
    setResearching(true);
    setResearchError(null);
    try {
      const res = await fetch("/api/admin/morning-email/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stocks }),
        cache: "no-store",
      });
      const data = (await res.json()) as ResearchResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setStocks(data.stocks ?? []);
      setQa(data.qa ?? []);
    } catch (e) {
      setResearchError(e instanceof Error ? e.message : "Research failed");
    } finally {
      setResearching(false);
    }
  }, [stocks]);

  const updateStock = useCallback((index: number, patch: Partial<MorningEmailStock>) => {
    setStocks((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }, []);

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

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        <SectionLabel>Force tickers (optional, comma-separated)</SectionLabel>
        <input
          value={forceTickers}
          onChange={(e) => setForceTickers(e.target.value)}
          placeholder="e.g. AAPL, TSLA, GME"
          style={inputStyle}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={onScan} disabled={scanning || researching} style={ctrlBtn}>
          {scanning ? "SCANNING…" : "SCAN POLYGON"}
        </button>
        <button onClick={onResearch} disabled={researching || scanning || stocks.length === 0} style={ctrlBtn}>
          {researching ? "RESEARCHING…" : "RESEARCH SOURCES"}
        </button>
        <button style={ctrlBtn} disabled title={tooltip}>GENERATE PREVIEW</button>
        <button style={ctrlBtn} disabled title={tooltip}>COPY HTML</button>
        <button style={ctrlBtn} disabled title={tooltip}>DOWNLOAD HTML</button>
        {live === true ? <Pill text="LIVE" tone="ok" /> : null}
        {live === false && stocks.length > 0 ? <Pill text="FORCED" tone="info" /> : null}
      </div>

      {scanError ? (
        <div style={errorBanner}>{scanError}</div>
      ) : null}
      {researchError ? (
        <div style={errorBanner}>{researchError}</div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 20 }}>
        <div>
          <SectionLabel>Subject</SectionLabel>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={inputStyle}
          />

          <SectionLabel>Stocks ({stocks.length})</SectionLabel>
          {stocks.length === 0 ? (
            <div style={emptyState}>No stocks scanned yet.</div>
          ) : (
            <>
              <StockTable stocks={stocks} />
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 16 }}>
                {stocks.map((s, i) => (
                  <StockEditor key={`${s.ticker}-${i}`} stock={s} onChange={(patch) => updateStock(i, patch)} />
                ))}
              </div>
            </>
          )}

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

function StockTable({ stocks }: { stocks: MorningEmailStock[] }) {
  return (
    <div style={tableWrap}>
      <table style={tableStyle}>
        <thead>
          <tr style={{ background: "var(--bg)" }}>
            {["Ticker", "Name", "Chg %", "Last", "Volume", "Mkt Cap", "Float"].map((h) => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stocks.map((s) => (
            <tr key={s.ticker}>
              <td style={{ ...tdStyle, fontWeight: 600 }}>{s.ticker}</td>
              <td style={tdStyle}>{s.name || "—"}</td>
              <td style={{ ...tdStyle, color: s.change_pct > 0 ? "var(--accent)" : "var(--danger)" }}>
                {s.change_pct > 0 ? "+" : ""}{s.change_pct.toFixed(2)}%
              </td>
              <td style={tdStyle}>${s.last.toFixed(2)}</td>
              <td style={tdStyle}>{s.volume.toLocaleString()}</td>
              <td style={tdStyle}>{s.market_cap || "—"}</td>
              <td style={tdStyle}>{s.float || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StockEditor({ stock, onChange }: { stock: MorningEmailStock; onChange: (patch: Partial<MorningEmailStock>) => void }) {
  const riskFlagsText = stock.risk_flags.join(", ");
  const sourceUrlsText = stock.source_urls.join("\n");
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: 1 }}>
          {stock.ticker} <span style={{ color: "var(--text-secondary)", fontWeight: 400, fontSize: 12, marginLeft: 6 }}>{stock.name || ""}</span>
        </div>
        <div style={{ fontSize: 11, color: stock.change_pct > 0 ? "var(--accent)" : "var(--danger)" }}>
          {stock.change_pct > 0 ? "+" : ""}{stock.change_pct.toFixed(2)}% · ${stock.last.toFixed(2)}
        </div>
      </div>

      <FieldLabel>Catalyst</FieldLabel>
      <textarea
        value={stock.catalyst}
        onChange={(e) => onChange({ catalyst: e.target.value })}
        rows={3}
        style={textareaStyle}
      />

      <FieldLabel>Sentiment</FieldLabel>
      <textarea
        value={stock.sentiment}
        onChange={(e) => onChange({ sentiment: e.target.value })}
        rows={2}
        style={textareaStyle}
      />

      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, marginTop: 8 }}>
        <div>
          <FieldLabel>Confidence</FieldLabel>
          <select
            value={stock.confidence}
            onChange={(e) => onChange({ confidence: e.target.value as Confidence })}
            style={inputStyle}
          >
            <option value="">—</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
        </div>
        <div>
          <FieldLabel>Risk flags (comma-separated)</FieldLabel>
          <input
            value={riskFlagsText}
            onChange={(e) => onChange({
              risk_flags: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })}
            style={inputStyle}
          />
        </div>
      </div>

      <FieldLabel>Evidence notes</FieldLabel>
      <textarea
        value={stock.evidence_notes}
        onChange={(e) => onChange({ evidence_notes: e.target.value })}
        rows={4}
        style={textareaStyle}
      />

      <FieldLabel>Source URLs (one per line)</FieldLabel>
      <textarea
        value={sourceUrlsText}
        onChange={(e) => onChange({
          source_urls: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        })}
        rows={3}
        style={textareaStyle}
      />
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9, color: "var(--text-secondary)", letterSpacing: 1.5, textTransform: "uppercase", marginTop: 8, marginBottom: 4 }}>
      {children}
    </div>
  );
}

function Pill({ text, tone }: { text: string; tone: "ok" | "info" }) {
  const color = tone === "ok" ? "var(--accent)" : "var(--text-secondary)";
  return (
    <span style={{
      fontSize: 9, padding: "3px 8px", border: `1px solid ${color}`,
      color, borderRadius: 3, letterSpacing: 1, fontFamily: font,
    }}>{text}</span>
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

const errorBanner: React.CSSProperties = {
  background: "var(--danger-20)", border: "1px solid var(--danger)", color: "var(--danger)",
  padding: "10px 14px", borderRadius: 4, marginBottom: 16, fontSize: 13,
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

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 4, padding: "14px 16px",
  background: "var(--bg-secondary, transparent)",
};

const tableWrap: React.CSSProperties = {
  border: "1px solid var(--border)", borderRadius: 4, overflowX: "auto",
};

const tableStyle: React.CSSProperties = {
  width: "100%", borderCollapse: "collapse", fontSize: 12,
};

const thStyle: React.CSSProperties = {
  padding: "10px 12px", textAlign: "left", fontSize: 10,
  letterSpacing: 1, textTransform: "uppercase",
  color: "var(--text-secondary)", borderBottom: "1px solid var(--border)",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px", color: "var(--text-primary)",
  borderBottom: "1px solid var(--border)",
};
