"use client";

import React, { useCallback, useState } from "react";
import {
  DEFAULT_CLOSING_1,
  DEFAULT_CLOSING_2,
  DEFAULT_SUBJECT,
  type Confidence,
  type MorningEmailStock,
  type PriceTarget,
  type PriceTargets,
  type QaMessage,
} from "@/lib/morning-email/types";

type TargetTier = "upside" | "stretch" | "downside";

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

type GenerateResponse = {
  html: string;
  qa: QaMessage[];
  draftId: string | null;
};

type GenerateTargetsResponse = {
  targets: Record<string, PriceTargets>;
  errors: Record<string, string>;
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
  const [generating, setGenerating] = useState<boolean>(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [html, setHtml] = useState<string>("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [targetsAllBusy, setTargetsAllBusy] = useState<boolean>(false);
  const [perTargetBusy, setPerTargetBusy] = useState<Record<string, boolean>>({});
  const [targetErrors, setTargetErrors] = useState<Record<string, string>>({});
  const [targetsAllError, setTargetsAllError] = useState<string | null>(null);

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

  const onGenerate = useCallback(async () => {
    if (stocks.length === 0) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch("/api/admin/morning-email/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, stocks, closing1, closing2 }),
        cache: "no-store",
      });
      const data = (await res.json()) as GenerateResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setHtml(data.html ?? "");
      setQa(data.qa ?? []);
      setDraftId(data.draftId ?? null);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setGenerating(false);
    }
  }, [subject, stocks, closing1, closing2]);

  const onCopy = useCallback(async () => {
    if (!html) return;
    try {
      await navigator.clipboard.writeText(html);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 2000);
    }
  }, [html]);

  const onDownload = useCallback(() => {
    if (!html) return;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const today = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `morning-email-${today}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [html]);

  const runTargetGeneration = useCallback(async (subset: MorningEmailStock[]) => {
    if (subset.length === 0) return;
    const tickers = subset.map((s) => s.ticker);
    const isBatch = subset.length === stocks.length;

    if (isBatch) setTargetsAllBusy(true);
    else setPerTargetBusy((prev) => {
      const next = { ...prev };
      for (const t of tickers) next[t] = true;
      return next;
    });
    setTargetsAllError(null);

    try {
      const res = await fetch("/api/admin/morning-email/generate-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stocks: subset.map((s) => ({
            ticker: s.ticker,
            name: s.name,
            last: s.last,
            change_pct: s.change_pct,
            float: s.float,
            volume: s.volume,
            market_cap: s.market_cap,
            catalyst: s.catalyst,
            source_urls: s.source_urls,
          })),
        }),
        cache: "no-store",
      });
      const data = (await res.json()) as GenerateTargetsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      setStocks((prev) => prev.map((s) => {
        const next = data.targets[s.ticker];
        return next ? { ...s, price_targets: next } : s;
      }));

      setTargetErrors((prev) => {
        const updated = { ...prev };
        for (const t of tickers) delete updated[t];
        for (const [t, msg] of Object.entries(data.errors ?? {})) updated[t] = msg;
        return updated;
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Target generation failed";
      if (isBatch) {
        setTargetsAllError(msg);
      } else {
        setTargetErrors((prev) => {
          const updated = { ...prev };
          for (const t of tickers) updated[t] = msg;
          return updated;
        });
      }
    } finally {
      if (isBatch) setTargetsAllBusy(false);
      else setPerTargetBusy((prev) => {
        const next = { ...prev };
        for (const t of tickers) delete next[t];
        return next;
      });
    }
  }, [stocks]);

  const onGenerateAllTargets = useCallback(() => {
    runTargetGeneration(stocks);
  }, [runTargetGeneration, stocks]);

  const onGenerateTargetsForIndex = useCallback((index: number) => {
    const s = stocks[index];
    if (!s) return;
    runTargetGeneration([s]);
  }, [runTargetGeneration, stocks]);

  const updateTargetTier = useCallback((index: number, tier: TargetTier, patch: Partial<PriceTarget>) => {
    setStocks((prev) => prev.map((s, i) => {
      if (i !== index) return s;
      const current = s.price_targets[tier] ?? { price: 0, pct: 0, rationale: "" };
      return {
        ...s,
        price_targets: {
          ...s.price_targets,
          [tier]: { ...current, ...patch },
          generated_by: "manual",
        },
      };
    }));
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
        <button onClick={onResearch} disabled={researching || scanning || generating || stocks.length === 0} style={ctrlBtn}>
          {researching ? "RESEARCHING…" : "RESEARCH SOURCES"}
        </button>
        <button onClick={onGenerateAllTargets} disabled={targetsAllBusy || stocks.length === 0} style={ctrlBtn}>
          {targetsAllBusy ? "GENERATING TARGETS…" : "GENERATE ALL TARGETS"}
        </button>
        <button onClick={onGenerate} disabled={generating || scanning || researching || stocks.length === 0} style={ctrlBtn}>
          {generating ? "GENERATING…" : "GENERATE PREVIEW"}
        </button>
        <button onClick={onCopy} disabled={!html} style={ctrlBtn}>
          {copyState === "copied" ? "COPIED ✓" : copyState === "error" ? "COPY FAILED" : "COPY HTML"}
        </button>
        <button onClick={onDownload} disabled={!html} style={ctrlBtn}>DOWNLOAD HTML</button>
        {live === true ? <Pill text="LIVE" tone="ok" /> : null}
        {live === false && stocks.length > 0 ? <Pill text="FORCED" tone="info" /> : null}
        {draftId ? <Pill text={`ARCHIVED ${draftId.slice(0, 8)}`} tone="ok" /> : null}
      </div>

      {scanError ? (
        <div style={errorBanner}>{scanError}</div>
      ) : null}
      {researchError ? (
        <div style={errorBanner}>{researchError}</div>
      ) : null}
      {generateError ? (
        <div style={errorBanner}>{generateError}</div>
      ) : null}
      {targetsAllError ? (
        <div style={errorBanner}>Target generation failed: {targetsAllError}</div>
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
                  <StockEditor
                    key={`${s.ticker}-${i}`}
                    stock={s}
                    onChange={(patch) => updateStock(i, patch)}
                    onGenerateTargets={() => onGenerateTargetsForIndex(i)}
                    onUpdateTier={(tier, patch) => updateTargetTier(i, tier, patch)}
                    targetsBusy={targetsAllBusy || Boolean(perTargetBusy[s.ticker])}
                    targetError={targetErrors[s.ticker] || null}
                  />
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
          {html ? (
            <iframe
              title="Morning email preview"
              srcDoc={html}
              sandbox=""
              style={previewIframe}
            />
          ) : (
            <div style={previewFrame}>
              <div style={{ color: "var(--text-secondary)", fontSize: 12, padding: 24, textAlign: "center" }}>
                Generated HTML preview will render here.<br />Click GENERATE PREVIEW once stocks are scanned.
              </div>
            </div>
          )}
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

function StockEditor({
  stock,
  onChange,
  onGenerateTargets,
  onUpdateTier,
  targetsBusy,
  targetError,
}: {
  stock: MorningEmailStock;
  onChange: (patch: Partial<MorningEmailStock>) => void;
  onGenerateTargets: () => void;
  onUpdateTier: (tier: TargetTier, patch: Partial<PriceTarget>) => void;
  targetsBusy: boolean;
  targetError: string | null;
}) {
  const riskFlagsText = stock.risk_flags.join(", ");
  const sourceUrlsText = stock.source_urls.join("\n");
  const t = stock.price_targets;
  const targetsBadge =
    t.generated_by === "ai" ? "(AI)" :
    t.generated_by === "manual" ? "(edited)" : "";
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

      <FieldLabel>Catalyst headline</FieldLabel>
      <input
        value={stock.catalyst_headline ?? ""}
        onChange={(e) => {
          const v = e.target.value;
          onChange({ catalyst_headline: v.trim() === "" ? undefined : v });
        }}
        placeholder="12-20 word plain-English summary (bold opener)"
        style={inputStyle}
      />

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

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--border)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <FieldLabel>
            Targets {targetsBadge ? <span style={{ marginLeft: 4, color: "var(--text-secondary)", textTransform: "none", letterSpacing: 0 }}>{targetsBadge}</span> : null}
          </FieldLabel>
          <button onClick={onGenerateTargets} disabled={targetsBusy} style={smallTargetBtn}>
            {targetsBusy ? "GENERATING…" : "GENERATE TARGETS"}
          </button>
        </div>
        {targetError ? (
          <div style={{ ...errorBanner, marginBottom: 8 }}>Generation failed: {targetError}. Edit manually or retry.</div>
        ) : null}
        {!t.upside && !t.stretch && !t.downside && !targetsBusy ? (
          <div style={{ ...emptyState, padding: "12px" }}>No targets generated yet. Click GENERATE TARGETS.</div>
        ) : (
          <>
            <TargetTierRow tier="upside" target={t.upside} onChange={(p) => onUpdateTier("upside", p)} />
            <TargetTierRow tier="stretch" target={t.stretch} onChange={(p) => onUpdateTier("stretch", p)} />
            <TargetTierRow tier="downside" target={t.downside} onChange={(p) => onUpdateTier("downside", p)} />
          </>
        )}
      </div>
    </div>
  );
}

function TargetTierRow({
  tier,
  target,
  onChange,
}: {
  tier: TargetTier;
  target: PriceTarget | null;
  onChange: (patch: Partial<PriceTarget>) => void;
}) {
  const t = target ?? { price: 0, pct: 0, rationale: "" };
  const labelColor = tier === "upside" ? "var(--accent)" : tier === "stretch" ? "var(--accent)" : "var(--danger)";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "80px 110px 90px 1fr", gap: 8, alignItems: "start", marginBottom: 8 }}>
      <div style={{ fontSize: 9, padding: "10px 0 0", color: labelColor, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700 }}>
        {tier}
      </div>
      <input
        type="number"
        step="0.01"
        value={target ? t.price : ""}
        onChange={(e) => onChange({ price: Number(e.target.value) || 0 })}
        placeholder="$0.00"
        style={inputStyle}
      />
      <input
        type="number"
        step="0.1"
        value={target ? t.pct : ""}
        onChange={(e) => onChange({ pct: Number(e.target.value) || 0 })}
        placeholder="0.0"
        style={inputStyle}
      />
      <textarea
        value={t.rationale}
        onChange={(e) => onChange({ rationale: e.target.value })}
        rows={1}
        placeholder={target ? "" : "—"}
        style={{ ...textareaStyle, minHeight: 32 }}
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

const previewIframe: React.CSSProperties = {
  width: "100%", minHeight: 800, border: "1px solid var(--border)",
  borderRadius: 4, background: "#fff",
};

const smallTargetBtn: React.CSSProperties = {
  fontSize: 9, padding: "5px 10px",
  background: "transparent", color: "var(--text-primary)",
  border: "1px solid var(--border)", borderRadius: 3,
  letterSpacing: 1, textTransform: "uppercase", fontFamily: font,
  cursor: "pointer", fontWeight: 700,
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
