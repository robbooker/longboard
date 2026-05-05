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

const fonts = {
  body: "Helvetica, 'Helvetica Neue', Arial, sans-serif",
  mono: "'Courier New', Courier, monospace",
  serif: "Georgia, 'Times New Roman', serif",
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
            catalyst: (Array.isArray(s.catalyst) ? s.catalyst : []).join(" "),
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
    <div className="ma-root" style={pageShell}>
      <style>{morningEmailCss}</style>
      <nav className="ma-nav">
        <div className="ma-nav-inner">
          <a href="/command2" className="ma-brand" aria-label="LongboardAI Command Center">
            <span className="ma-mark">L</span>
            LONGBOARD<em>AI</em>
          </a>
          <ul>
            <li>
              <a href="/command2">Command Center</a>
            </li>
            <li className="active">Morning Email</li>
            <li>
              <a href="/admin">Admin</a>
            </li>
            <li>
              <a href="/learn">Learn</a>
            </li>
          </ul>
          <div className="ma-nav-right">
            <span className="ma-live-pip">ADMIN TOOL</span>
            <a href="/admin/morning-email/history" className="ma-nav-link">History</a>
          </div>
        </div>
      </nav>

      <div className="ma-strip">
        <div className="ma-strip-inner">
          <span className="ma-strip-tag">● MORNING DESK</span>
          <span>SCAN POLYGON</span>
          <span>RESEARCH SOURCES</span>
          <span>REVIEW / EDIT</span>
          <span>GENERATE PREVIEW</span>
          <span className="ma-clock">ARCHIVE ENABLED · NO SEND</span>
        </div>
      </div>

      <main style={mainWrap}>
        <section style={pageHeader}>
          <div>
            <div style={crumb}>ADMIN <span>/</span> MORNING EMAIL <span>/</span> DAILY BRIEF</div>
            <h1 className="ma-title" style={titleStyle}>
              Morning<br /><span>Email.</span>
            </h1>
            <p style={subtitleStyle}>
              Build the daily trading note with the same editorial chrome as Command Center:
              ranked names, source-backed catalysts, AI targets, and a paper-ready preview.
            </p>
          </div>
          <div className="ma-head-meta" style={headMeta}>
            <div>STOCKS<b>{stocks.length}</b></div>
            <div>MODE<b style={{ color: live === true ? "#B8860B" : "#15120B" }}>{live === true ? "LIVE" : live === false ? "FORCED" : "READY"}</b></div>
            <div>DRAFT<b>{draftId ? draftId.slice(0, 6).toUpperCase() : "NONE"}</b></div>
          </div>
        </section>

        <section style={workflowPanel}>
          <div>
            <div style={darkPanelLabel}>Workflow</div>
            <div style={workflowText}>
              Scan Polygon → Research Sources → Review/Edit → Generate Preview → Copy / Download HTML.
              Generated emails are archived to <code>morning_email_archive</code>. No send, no upload.
            </div>
          </div>
          <a href="/admin" style={adminBackBtn}>← Admin</a>
        </section>

        <section style={controlDeck}>
          <div style={tickerControl}>
            <SectionLabel>Force tickers (optional, comma-separated)</SectionLabel>
            <input
              value={forceTickers}
              onChange={(e) => setForceTickers(e.target.value)}
              placeholder="e.g. AAPL, TSLA, GME"
              style={inputStyle}
            />
          </div>

          <div style={buttonRail}>
            <button onClick={onScan} disabled={scanning || researching} style={ctrlBtn}>
              {scanning ? "SCANNING…" : "SCAN POLYGON"}
            </button>
            <button onClick={onResearch} disabled={researching || scanning || generating || stocks.length === 0} style={ctrlBtn}>
              {researching ? "RESEARCHING…" : "RESEARCH SOURCES"}
            </button>
            <button onClick={onGenerateAllTargets} disabled={targetsAllBusy || stocks.length === 0} style={ctrlBtn}>
              {targetsAllBusy ? "GENERATING TARGETS…" : "GENERATE ALL TARGETS"}
            </button>
            <button onClick={onGenerate} disabled={generating || scanning || researching || stocks.length === 0} style={primaryCtrlBtn}>
              {generating ? "GENERATING…" : "GENERATE PREVIEW"}
            </button>
            <button onClick={onCopy} disabled={!html} style={ctrlBtn}>
              {copyState === "copied" ? "COPIED" : copyState === "error" ? "COPY FAILED" : "COPY HTML"}
            </button>
            <button onClick={onDownload} disabled={!html} style={ctrlBtn}>DOWNLOAD HTML</button>
            {live === true ? <Pill text="LIVE" tone="ok" /> : null}
            {live === false && stocks.length > 0 ? <Pill text="FORCED" tone="info" /> : null}
            {draftId ? <Pill text={`ARCHIVED ${draftId.slice(0, 8)}`} tone="ok" /> : null}
          </div>
        </section>

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

      <section className="ma-workgrid" style={workGrid}>
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
      </section>
      </main>
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

      <FieldLabel>Catalyst (one bullet per line, 3-4 bullets, 8-15 words each)</FieldLabel>
      <textarea
        value={(Array.isArray(stock.catalyst) ? stock.catalyst : []).join("\n")}
        onChange={(e) => onChange({
          catalyst: e.target.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
        })}
        rows={4}
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
    <div className="ma-target-row" style={{ display: "grid", gridTemplateColumns: "80px 110px 90px 1fr", gap: 8, alignItems: "start", marginBottom: 8 }}>
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
    <div style={{ fontSize: 10, color: "var(--gold)", letterSpacing: 1.4, textTransform: "uppercase", marginTop: 10, marginBottom: 5, fontFamily: fonts.mono, fontWeight: 700 }}>
      {children}
    </div>
  );
}

function Pill({ text, tone }: { text: string; tone: "ok" | "info" }) {
  const color = tone === "ok" ? "var(--amber)" : "var(--ink-55)";
  return (
    <span style={{
      fontSize: 10, padding: "8px 10px", border: `1px solid ${color}`,
      color, letterSpacing: 1.4, fontFamily: fonts.mono, fontWeight: 700,
      background: tone === "ok" ? "rgba(245,165,36,0.12)" : "rgba(21,18,11,0.05)",
    }}>{text}</span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: "var(--gold)", letterSpacing: 1.8, textTransform: "uppercase", marginTop: 18, marginBottom: 8, fontFamily: fonts.mono, fontWeight: 700 }}>
      {children}
    </div>
  );
}

function qaColor(level: "ok" | "warning" | "error"): string {
  if (level === "error") return "var(--danger)";
  if (level === "warning") return "var(--warning)";
  return "var(--ink-70)";
}

const morningEmailCss = `
  .ma-root{
    --cream:#F6F2E9;
    --card:#FBF8F0;
    --card-2:#EFEADD;
    --ink:#15120B;
    --ink-70:rgba(21,18,11,0.72);
    --ink-55:rgba(21,18,11,0.55);
    --ink-30:rgba(21,18,11,0.16);
    --amber:#F5A524;
    --gold:#B8860B;
    --paper:rgba(244,241,232,0.86);
    --paper-55:rgba(244,241,232,0.55);
    --paper-18:rgba(244,241,232,0.18);
    --accent:#B8860B;
    --danger:#C8283D;
    --danger-20:rgba(200,40,61,0.12);
    --warning:#B8860B;
    --bg:#F6F2E9;
    --surface:#FBF8F0;
    --border:rgba(21,18,11,0.16);
    --text-primary:#15120B;
    --text-secondary:rgba(21,18,11,0.55);
    color:var(--ink);
    background:var(--cream);
    min-height:100vh;
    font-family:Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased;
  }
  .ma-root *{box-sizing:border-box}
  .ma-root a{color:inherit;text-decoration:none}
  .ma-nav{background:var(--ink);color:var(--paper);border-bottom:1px solid #000}
  .ma-nav-inner{max-width:1480px;margin:0 auto;display:flex;align-items:center;gap:32px;padding:14px 28px}
  .ma-brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-0.4px;font-size:18px}
  .ma-brand .ma-mark{width:26px;height:26px;background:var(--amber);color:var(--ink);display:grid;place-items:center;font-weight:900;font-size:14px}
  .ma-brand em{font-family:Georgia,serif;color:var(--amber);font-weight:500}
  .ma-nav ul{list-style:none;margin:0;padding:0;display:flex;gap:22px;font-size:13px;font-weight:600;color:rgba(244,241,232,0.78)}
  .ma-nav li.active{color:var(--amber)}
  .ma-nav li.active::before{content:"● ";font-size:9px;vertical-align:middle;margin-right:4px}
  .ma-nav-right{margin-left:auto;display:flex;align-items:center;gap:18px;font-size:12px;color:rgba(244,241,232,0.7)}
  .ma-live-pip{display:inline-flex;align-items:center;gap:6px;color:var(--amber);font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:1.6px;font-weight:700}
  .ma-live-pip::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 0 rgba(245,165,36,0.6);animation:ma-pulse 1.6s infinite}
  @keyframes ma-pulse{0%{box-shadow:0 0 0 0 rgba(245,165,36,0.55)}70%{box-shadow:0 0 0 8px rgba(245,165,36,0)}100%{box-shadow:0 0 0 0 rgba(245,165,36,0)}}
  .ma-nav-link{font-family:'Courier New',Courier,monospace;font-size:11px;letter-spacing:1.4px;border:1px solid var(--paper-18);padding:7px 12px;color:var(--paper)}
  .ma-strip{background:var(--ink);color:var(--paper);border-top:1px solid rgba(244,241,232,0.08);overflow:hidden;font-family:'Courier New',Courier,monospace;font-size:12px;letter-spacing:1.4px}
  .ma-strip-inner{display:flex;align-items:center;gap:24px;padding:10px 28px;max-width:1480px;margin:0 auto;white-space:nowrap}
  .ma-strip-tag{color:var(--amber);font-weight:700;margin-right:2px;border-right:1px solid rgba(244,241,232,0.18);padding-right:18px}
  .ma-clock{margin-left:auto;color:rgba(244,241,232,0.55);padding-left:18px;border-left:1px solid rgba(244,241,232,0.18)}
  .ma-title span{font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:500;letter-spacing:-1.6px}
  .ma-head-meta b{display:block;font-family:Helvetica,Arial,sans-serif;font-size:24px;letter-spacing:-.7px;color:var(--ink);margin-top:5px;font-weight:800}
  .ma-root code{font-family:'Courier New',Courier,monospace;color:var(--amber);letter-spacing:.6px}
  .ma-root input::placeholder,.ma-root textarea::placeholder{color:rgba(21,18,11,0.38)}
  .ma-root button:disabled{opacity:.42;cursor:not-allowed}
  .ma-root input:focus,.ma-root textarea:focus,.ma-root select:focus{outline:2px solid rgba(245,165,36,0.28);outline-offset:1px;border-color:var(--gold)}
  @media (max-width:1080px){.ma-workgrid{grid-template-columns:1fr!important}.ma-nav ul{display:none}.ma-strip{overflow-x:auto}.ma-clock{margin-left:0}.ma-strip-inner{width:max-content}}
  @media (max-width:768px){.ma-nav-inner{padding:14px 16px;gap:14px}.ma-nav-right{gap:10px}.ma-nav-link{display:none}.ma-strip-inner{padding-left:16px;padding-right:16px}.ma-root h1{font-size:42px!important}.ma-target-row{grid-template-columns:1fr!important}}
`;

const pageShell: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--cream)",
  color: "var(--ink)",
};

const mainWrap: React.CSSProperties = {
  maxWidth: 1480,
  margin: "0 auto",
  padding: "32px 28px 72px",
};

const crumb: React.CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: 11,
  letterSpacing: 1.8,
  color: "var(--gold)",
  fontWeight: 700,
  marginBottom: 14,
};

const pageHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "space-between",
  gap: 24,
  flexWrap: "wrap",
  borderBottom: "2px solid var(--amber)",
  paddingBottom: 24,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: fonts.body,
  fontSize: 64,
  lineHeight: 0.94,
  letterSpacing: -2.6,
  fontWeight: 800,
  color: "var(--ink)",
};

const subtitleStyle: React.CSSProperties = {
  fontFamily: fonts.serif,
  fontStyle: "italic",
  fontSize: 18,
  color: "var(--ink-70)",
  marginTop: 14,
  maxWidth: 760,
  lineHeight: 1.45,
};

const headMeta: React.CSSProperties = {
  display: "flex",
  gap: 28,
  alignItems: "flex-end",
  fontFamily: fonts.mono,
  fontSize: 11,
  letterSpacing: 1.4,
  color: "var(--ink-55)",
  fontWeight: 700,
};

const workflowPanel: React.CSSProperties = {
  marginTop: 28,
  background: "var(--ink)",
  color: "var(--paper)",
  border: "1px solid #000",
  padding: "20px 24px",
  display: "flex",
  justifyContent: "space-between",
  gap: 24,
  alignItems: "center",
};

const darkPanelLabel: React.CSSProperties = {
  fontFamily: fonts.mono,
  color: "var(--amber)",
  fontSize: 11,
  letterSpacing: 1.8,
  textTransform: "uppercase",
  fontWeight: 700,
  marginBottom: 8,
};

const workflowText: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.55,
  color: "var(--paper)",
};

const adminBackBtn: React.CSSProperties = {
  flex: "0 0 auto",
  fontFamily: fonts.mono,
  fontSize: 11,
  letterSpacing: 1.6,
  fontWeight: 700,
  color: "var(--amber)",
  border: "1px solid var(--paper-18)",
  padding: "10px 14px",
  textTransform: "uppercase",
};

const controlDeck: React.CSSProperties = {
  marginTop: 28,
  background: "var(--card)",
  border: "1px solid var(--ink-30)",
  padding: "22px 24px 24px",
};

const tickerControl: React.CSSProperties = {
  marginBottom: 16,
};

const buttonRail: React.CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  alignItems: "center",
};

const workGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(420px, 0.95fr)",
  gap: 28,
  marginTop: 30,
};

const ctrlBtn: React.CSSProperties = {
  fontSize: 11, padding: "10px 14px",
  background: "var(--card)", color: "var(--ink)",
  border: "1px solid var(--ink)", borderRadius: 0,
  letterSpacing: 1.4, textTransform: "uppercase", fontFamily: fonts.mono,
  cursor: "pointer",
  fontWeight: 700,
};

const primaryCtrlBtn: React.CSSProperties = {
  ...ctrlBtn,
  background: "var(--ink)",
  color: "var(--amber)",
};

const errorBanner: React.CSSProperties = {
  background: "var(--danger-20)", border: "1px solid var(--danger)", color: "var(--danger)",
  padding: "12px 14px", marginTop: 16, marginBottom: 0, fontSize: 13,
  fontFamily: fonts.body,
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "12px 12px", fontSize: 15,
  background: "rgba(255,255,255,0.38)", color: "var(--ink)",
  border: "1px solid var(--ink-30)", borderRadius: 0, fontFamily: fonts.body,
};

const textareaStyle: React.CSSProperties = {
  width: "100%", padding: "12px 12px", fontSize: 14, lineHeight: 1.55,
  background: "rgba(255,255,255,0.38)", color: "var(--ink)",
  border: "1px solid var(--ink-30)", borderRadius: 0, fontFamily: fonts.body, resize: "vertical",
};

const emptyState: React.CSSProperties = {
  padding: "24px", textAlign: "center", fontSize: 13,
  color: "var(--ink-55)", border: "1px dashed var(--ink-30)",
  background: "rgba(255,255,255,0.18)",
};

const previewFrame: React.CSSProperties = {
  border: "1px solid var(--ink-30)",
  minHeight: 680, background: "var(--card)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const previewIframe: React.CSSProperties = {
  width: "100%", minHeight: 860, border: "1px solid var(--ink-30)",
  background: "#fff",
};

const smallTargetBtn: React.CSSProperties = {
  fontSize: 10, padding: "7px 10px",
  background: "var(--ink)", color: "var(--amber)",
  border: "1px solid var(--ink)", borderRadius: 0,
  letterSpacing: 1.2, textTransform: "uppercase", fontFamily: fonts.mono,
  cursor: "pointer", fontWeight: 700,
};

const cardStyle: React.CSSProperties = {
  border: "1px solid var(--ink-30)", padding: "18px 20px",
  background: "var(--card)",
};

const tableWrap: React.CSSProperties = {
  border: "1px solid var(--ink-30)", overflowX: "auto",
  background: "var(--card)",
};

const tableStyle: React.CSSProperties = {
  width: "100%", borderCollapse: "collapse", fontSize: 12,
  fontFamily: fonts.body,
};

const thStyle: React.CSSProperties = {
  padding: "12px 12px", textAlign: "left", fontSize: 10,
  letterSpacing: 1.4, textTransform: "uppercase", fontFamily: fonts.mono,
  color: "var(--gold)", borderBottom: "1px solid var(--ink-30)",
};

const tdStyle: React.CSSProperties = {
  padding: "11px 12px", color: "var(--ink)",
  borderBottom: "1px solid var(--ink-30)",
};
