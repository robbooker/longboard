import type { MorningEmailDraft, MorningEmailStock, PriceTarget } from "./types";

const COLORS = {
  bg: "#F6F2E9",
  body: "#FBF8F0",
  ink: "#15120B",
  paper: "#F4F1E8",
  cream: "#EFEADD",
  gold: "#F5A524",
  goldDeep: "#B8860B",
};

const FONT_SANS = "Helvetica,Arial,sans-serif";
const FONT_SERIF = "Georgia,'Times New Roman',serif";
const FONT_MONO = "'Courier New',Courier,monospace";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatChange(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function formatPrice(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `$${n.toFixed(2)}`;
}

function formatVolume(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

export function stockCountLabel(count: number): string {
  const words = ["Zero", "One", "Two", "Three", "Four", "Five"];
  return words[count] ?? String(count);
}

export function chicagoDateLabel(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return `${get("weekday").toUpperCase()} · ${get("month").toUpperCase()} ${get("day")} · ${get("year")}`;
}

export function chicagoYmd(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function formatPctSigned(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

function normalizeCatalystBullets(c: unknown): string[] {
  if (Array.isArray(c)) {
    return c.map((s) => String(s).trim()).filter((s) => s.length > 0);
  }
  if (typeof c === "string") {
    return c.split(/\n\n+/).map((s) => s.trim()).filter((s) => s.length > 0);
  }
  return [];
}

function renderCatalystBody(
  stock: MorningEmailStock,
  opts: { headlineSize: number; bodySize: number; pBottom: number },
): string {
  const headline = (stock.catalyst_headline || "").trim();
  const bullets = normalizeCatalystBullets(stock.catalyst);

  const headlineHtml = headline
    ? `<div style="font-family:${FONT_SANS};font-size:${opts.headlineSize}px;font-weight:700;color:${COLORS.ink};line-height:1.4;letter-spacing:-0.3px;margin-bottom:${opts.pBottom}px;">${escapeHtml(headline)}</div>`
    : "";

  const bulletsHtml = bullets.length === 0
    ? ""
    : `<ul style="list-style:disc;padding-left:18px;margin:0;">${bullets.map((b) => `<li style="font-family:${FONT_SERIF};font-size:${opts.bodySize}px;line-height:1.5;color:${COLORS.ink};margin-bottom:6px;">${escapeHtml(b)}</li>`).join("")}</ul>`;

  return headlineHtml + bulletsHtml;
}

function aiTargetRow(label: string, target: PriceTarget, accent: boolean, isLast: boolean): string {
  const labelColor = accent ? COLORS.gold : "rgba(244,241,232,0.7)";
  const borderBottom = isLast ? "border-bottom:1px solid rgba(244,241,232,0.18);" : "";
  return `<tr class="level-row">
  <td style="padding:18px 0;border-top:1px solid rgba(244,241,232,0.18);${borderBottom}">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
      <tr>
        <td width="110" style="font-family:${FONT_MONO};font-size:11px;letter-spacing:1.4px;color:${labelColor};font-weight:700;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="font-family:${FONT_SANS};font-size:18px;font-weight:800;color:${COLORS.paper};letter-spacing:-0.5px;">
          ${escapeHtml(formatPrice(target.price))} <span style="color:rgba(244,241,232,0.7);font-weight:700;">(${escapeHtml(formatPctSigned(target.pct))})</span>
        </td>
      </tr>
    </table>
    <div style="margin-top:10px;font-family:${FONT_SERIF};font-style:italic;font-size:14px;line-height:1.5;color:rgba(244,241,232,0.78);">
      ${escapeHtml(target.rationale)}
    </div>
  </td>
</tr>`;
}

function renderAiTargetsBlock(stock: MorningEmailStock): string {
  const t = stock.price_targets;
  if (!t.upside || !t.stretch || !t.downside) return "";
  return `<tr>
  <td style="padding-top:32px;">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${COLORS.ink};">
      <tr>
        <td style="padding:24px 28px 8px;font-family:${FONT_SANS};">
          <div style="font-family:${FONT_MONO};font-size:10px;letter-spacing:1.8px;color:${COLORS.gold};font-weight:700;margin-bottom:6px;">PRICE TARGETS</div>
          <div style="font-family:${FONT_SANS};font-size:22px;font-weight:800;color:${COLORS.paper};letter-spacing:-0.6px;line-height:1.2;">Where it goes. <span style="font-family:${FONT_SERIF};font-style:italic;font-weight:500;color:${COLORS.gold};">Where it doesn't.</span></div>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px 26px;">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="font-family:${FONT_MONO};">
            ${aiTargetRow("UPSIDE", t.upside, true, false)}
            ${aiTargetRow("STRETCH", t.stretch, true, false)}
            ${aiTargetRow("DOWNSIDE", t.downside, false, true)}
          </table>
          <div style="margin-top:14px;font-family:${FONT_SERIF};font-style:italic;font-size:12px;color:rgba(244,241,232,0.55);line-height:1.4;">
            Targets generated by AI from public catalyst data. Not analyst targets. Not financial advice.
          </div>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function renderCompactTargets(stock: MorningEmailStock): string {
  const t = stock.price_targets;
  if (!t.upside || !t.stretch || !t.downside) return "";
  return `<tr>
  <td style="padding:0 0 12px;">
    <div style="font-family:${FONT_MONO};font-size:11px;letter-spacing:1.2px;color:rgba(21,18,11,0.75);font-weight:700;">
      <span style="color:${COLORS.goldDeep};">UPSIDE</span> ${escapeHtml(formatPrice(t.upside.price))} (${escapeHtml(formatPctSigned(t.upside.pct))}) &nbsp;·&nbsp; <span style="color:${COLORS.goldDeep};">DOWNSIDE</span> ${escapeHtml(formatPrice(t.downside.price))} (${escapeHtml(formatPctSigned(t.downside.pct))})
    </div>
  </td>
</tr>`;
}

function defaultPreheader(stock?: MorningEmailStock, totalCount = 5): string {
  if (!stock) return `${stockCountLabel(totalCount)} names on the radar this morning.`;
  const tail = totalCount > 1 ? ` — and ${totalCount - 1} more we're watching live.` : "";
  return `${stock.ticker} ${formatChange(stock.change_pct)}${tail}`;
}

function renderHead(subject: string, dateLabel: string): string {
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(subject)} — ${escapeHtml(dateLabel)}</title>
<!--[if mso]>
<style type="text/css">
  table, td, div, p, a { font-family: Helvetica, Arial, sans-serif !important; }
</style>
<![endif]-->
<style type="text/css">
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; display: block; }
  body { margin: 0 !important; padding: 0 !important; width: 100% !important; background: ${COLORS.bg}; }
  a { color: ${COLORS.goldDeep}; }

  @media screen and (max-width: 620px) {
    .container { width: 100% !important; }
    .px { padding-left: 24px !important; padding-right: 24px !important; }
    .h1 { font-size: 44px !important; line-height: 0.96 !important; letter-spacing: -1.6px !important; }
    .h2 { font-size: 26px !important; }
    .pulse-stat { display: block !important; width: 100% !important; padding: 0 0 12px 0 !important; }
    .stock-num { font-size: 56px !important; }
    .stock-ticker { font-size: 36px !important; }
    .pick-num { font-size: 88px !important; }
    .pick-ticker { font-size: 56px !important; }
    .level-row td { display: block !important; width: 100% !important; padding: 4px 0 !important; }
    .level-row td.level-note { text-align: left !important; padding-bottom: 14px !important; }
    .stat-num { font-size: 26px !important; }
  }
</style>
</head>`;
}

function renderHeader(dateLabel: string): string {
  return `<tr>
  <td style="background:${COLORS.ink};color:${COLORS.gold};padding:18px 32px;font-family:${FONT_MONO};font-size:12px;letter-spacing:2px;font-weight:700;">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
      <tr>
        <td align="left">● MORNING BRIEF · LONGBOARD AI</td>
        <td align="right" style="color:rgba(244,241,232,0.6);">${escapeHtml(dateLabel)}</td>
      </tr>
    </table>
  </td>
</tr>`;
}

function renderHero(subject: string, stockCount: number): string {
  return `<tr>
  <td class="px" style="padding:56px 40px 8px;font-family:${FONT_SANS};">
    <div style="font-family:${FONT_MONO};font-size:11px;letter-spacing:1.8px;color:${COLORS.goldDeep};font-weight:700;margin-bottom:24px;">
      ● ${escapeHtml(subject.toUpperCase())}
    </div>
    <h1 class="h1" style="margin:0;font-family:${FONT_SANS};font-size:60px;line-height:0.94;letter-spacing:-2.4px;font-weight:800;color:${COLORS.ink};">
      ${escapeHtml(stockCountLabel(stockCount))} ${stockCount === 1 ? "name" : "names"}<br/>
      <span style="font-family:${FONT_SERIF};font-style:italic;font-weight:500;letter-spacing:-1.6px;">on the radar</span><br/>
      this morning.
    </h1>
    <div style="font-family:${FONT_SERIF};font-size:18px;line-height:1.5;color:rgba(21,18,11,0.72);margin-top:22px;font-style:italic;">
      Ranked by conviction. Movers we're watching at the open — what's real, what's noise.
    </div>
  </td>
</tr>`;
}

function renderIntro(): string {
  return `<tr>
  <td class="px" style="padding:36px 40px 0;font-family:${FONT_SERIF};font-size:17px;line-height:1.6;color:${COLORS.ink};">
    Every morning before the open we scan the top pre-market movers — checking catalysts, float, volume, risk factors, and real-time trader sentiment. Below: the names we're watching today.
  </td>
</tr>`;
}

function renderMarketPulse(stocks: MorningEmailStock[]): string {
  if (stocks.length === 0) return "";

  const sorted = [...stocks].sort((a, b) => b.change_pct - a.change_pct);
  const topRunner = sorted[0];
  const avgMove = stocks.reduce((s, x) => s + x.change_pct, 0) / stocks.length;
  const totalVol = stocks.reduce((s, x) => s + x.volume, 0);

  return `<tr>
  <td class="px" style="padding:48px 40px 0;">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${COLORS.ink};color:${COLORS.paper};">
      <tr>
        <td style="padding:32px 32px 8px;font-family:${FONT_SANS};">
          <div style="font-family:${FONT_MONO};font-size:10px;letter-spacing:2px;color:${COLORS.gold};font-weight:700;margin-bottom:14px;">● MORNING MARKET PULSE</div>
          <div class="h2" style="font-family:${FONT_SANS};font-size:32px;letter-spacing:-1px;font-weight:800;color:${COLORS.paper};line-height:1.05;">
            ${stocks.length} mover${stocks.length === 1 ? "" : "s"} <span style="color:${COLORS.gold};">on the board.</span><br/>
            <span style="font-family:${FONT_SERIF};font-style:italic;font-weight:500;color:rgba(244,241,232,0.85);">Volume tells the truth.</span>
          </div>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px 0;">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-top:1px solid rgba(244,241,232,0.18);">
            <tr>
              <td class="pulse-stat" width="33%" valign="top" style="padding:18px 16px 18px 0;border-right:1px solid rgba(244,241,232,0.18);">
                <div style="font-family:${FONT_MONO};font-size:10px;letter-spacing:1.6px;color:rgba(244,241,232,0.55);font-weight:700;margin-bottom:8px;">AVG MOVE</div>
                <div class="stat-num" style="font-family:${FONT_SANS};font-size:34px;font-weight:800;color:${COLORS.paper};letter-spacing:-1.2px;line-height:1;">${formatChange(avgMove).replace("%", "")}<span style="color:${COLORS.gold};font-size:22px;">%</span></div>
                <div style="font-family:${FONT_SERIF};font-size:13px;font-style:italic;color:rgba(244,241,232,0.65);margin-top:6px;line-height:1.4;">across the board</div>
              </td>
              <td class="pulse-stat" width="34%" valign="top" style="padding:18px 16px;border-right:1px solid rgba(244,241,232,0.18);">
                <div style="font-family:${FONT_MONO};font-size:10px;letter-spacing:1.6px;color:rgba(244,241,232,0.55);font-weight:700;margin-bottom:8px;">TOP RUNNER</div>
                <div class="stat-num" style="font-family:${FONT_SANS};font-size:34px;font-weight:800;color:${COLORS.gold};letter-spacing:-1.2px;line-height:1;">${escapeHtml(topRunner.ticker)}</div>
                <div style="font-family:${FONT_SERIF};font-size:13px;font-style:italic;color:rgba(244,241,232,0.65);margin-top:6px;line-height:1.4;">${escapeHtml(formatChange(topRunner.change_pct))} on ${escapeHtml(formatVolume(topRunner.volume))} vol</div>
              </td>
              <td class="pulse-stat" width="33%" valign="top" style="padding:18px 0 18px 16px;">
                <div style="font-family:${FONT_MONO};font-size:10px;letter-spacing:1.6px;color:rgba(244,241,232,0.55);font-weight:700;margin-bottom:8px;">TOTAL VOL</div>
                <div class="stat-num" style="font-family:${FONT_SANS};font-size:34px;font-weight:800;color:${COLORS.paper};letter-spacing:-1.2px;line-height:1;">${escapeHtml(formatVolume(totalVol))}</div>
                <div style="font-family:${FONT_SERIF};font-size:13px;font-style:italic;color:rgba(244,241,232,0.65);margin-top:6px;line-height:1.4;">across these names</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 32px 32px;">
          <div style="border-left:3px solid ${COLORS.gold};padding:6px 0 6px 18px;font-family:${FONT_SERIF};font-size:16px;line-height:1.55;color:${COLORS.paper};">
            <strong style="font-family:${FONT_SANS};font-weight:800;font-style:normal;letter-spacing:-0.2px;">Game plan:</strong> <em>Demand confirmation before sizing.</em> First-minute pops fade fast. Let VWAP hold and watch the tape before pressing.
          </div>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function renderTopPickHeader(): string {
  return `<tr>
  <td class="px" style="padding:56px 40px 0;font-family:${FONT_SANS};">
    <div style="border-top:2px solid ${COLORS.gold};padding-top:24px;font-family:${FONT_MONO};font-size:11px;letter-spacing:1.8px;color:${COLORS.goldDeep};font-weight:700;margin-bottom:18px;">
      TOP PICK · ★ HIGHEST CONVICTION
    </div>
  </td>
</tr>`;
}

function renderTopPick(stock: MorningEmailStock): string {
  const targetsBlock = renderAiTargetsBlock(stock);
  const riskFlagsLine = stock.risk_flags.length > 0
    ? `<div style="margin-top:14px;font-family:${FONT_MONO};font-size:11px;letter-spacing:1.4px;color:${COLORS.goldDeep};font-weight:700;">▲ RISK FLAGS · ${escapeHtml(stock.risk_flags.join(" · ").toUpperCase())}</div>`
    : "";

  const sentimentBlock = stock.sentiment.trim()
    ? `<tr>
        <td style="padding-top:32px;">
          <div style="font-family:${FONT_MONO};font-size:10px;letter-spacing:1.8px;color:${COLORS.goldDeep};font-weight:700;margin-bottom:10px;">→ WHAT TRADERS ARE SAYING</div>
          <div style="font-family:${FONT_SERIF};font-size:17px;line-height:1.6;color:${COLORS.ink};">
            ${escapeHtml(stock.sentiment)}
          </div>
        </td>
      </tr>`
    : "";

  return `<tr>
  <td class="px" style="padding:0 40px;">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
      <tr>
        <td valign="top" style="font-family:${FONT_SANS};">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
            <tr>
              <td valign="top" width="160" style="padding-right:8px;">
                <div class="pick-num" style="font-family:${FONT_SANS};font-size:140px;font-weight:800;color:${COLORS.gold};letter-spacing:-7px;line-height:0.85;">01</div>
              </td>
              <td valign="top" style="padding-top:14px;">
                <div class="pick-ticker" style="font-family:${FONT_SANS};font-size:68px;font-weight:800;color:${COLORS.ink};letter-spacing:-3px;line-height:0.95;">${escapeHtml(stock.ticker)}</div>
                <div style="font-family:${FONT_SERIF};font-style:italic;font-size:18px;color:rgba(21,18,11,0.7);margin-top:8px;line-height:1.35;">${escapeHtml(stock.name || "")}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding-top:28px;">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${COLORS.gold};">
            <tr>
              <td style="padding:24px 28px;font-family:${FONT_SANS};">
                <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
                  <tr>
                    <td valign="middle">
                      <div style="font-family:${FONT_MONO};font-size:10px;letter-spacing:1.8px;color:${COLORS.ink};font-weight:700;margin-bottom:6px;">AT THE OPEN</div>
                      <div style="font-family:${FONT_SANS};font-size:44px;font-weight:800;color:${COLORS.ink};letter-spacing:-1.8px;line-height:1;">${escapeHtml(formatChange(stock.change_pct).replace("%", ""))}<span style="font-size:28px;">%</span></div>
                    </td>
                    <td valign="middle" align="right" style="font-family:${FONT_SANS};">
                      <div style="font-family:${FONT_MONO};font-size:10px;letter-spacing:1.8px;color:rgba(21,18,11,0.7);font-weight:700;margin-bottom:6px;">PRICE</div>
                      <div style="font-family:${FONT_SANS};font-size:32px;font-weight:800;color:${COLORS.ink};letter-spacing:-1.2px;line-height:1;">${escapeHtml(formatPrice(stock.last))}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding-top:32px;">
          <div style="font-family:${FONT_MONO};font-size:10px;letter-spacing:1.8px;color:${COLORS.goldDeep};font-weight:700;margin-bottom:14px;">→ THE CATALYST</div>
          ${renderCatalystBody(stock, { headlineSize: 19, bodySize: 17, pBottom: 16 })}
          ${riskFlagsLine}
        </td>
      </tr>
      <tr>
        <td style="padding-top:32px;">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
            <tr>
              <td valign="top" width="50%" style="padding-right:10px;">
                <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${COLORS.cream};">
                  <tr>
                    <td style="padding:20px 22px;font-family:${FONT_SANS};">
                      <div style="font-family:${FONT_MONO};font-size:10px;letter-spacing:1.8px;color:${COLORS.goldDeep};font-weight:700;margin-bottom:8px;">FLOAT</div>
                      <div style="font-family:${FONT_SANS};font-size:28px;font-weight:800;color:${COLORS.ink};letter-spacing:-1.2px;line-height:1;">${escapeHtml(stock.float || "—")}</div>
                      <div style="font-family:${FONT_SERIF};font-size:13px;font-style:italic;color:rgba(21,18,11,0.65);margin-top:8px;line-height:1.4;">Shares outstanding</div>
                    </td>
                  </tr>
                </table>
              </td>
              <td valign="top" width="50%" style="padding-left:10px;">
                <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${COLORS.cream};">
                  <tr>
                    <td style="padding:20px 22px;font-family:${FONT_SANS};">
                      <div style="font-family:${FONT_MONO};font-size:10px;letter-spacing:1.8px;color:${COLORS.goldDeep};font-weight:700;margin-bottom:8px;">VOLUME</div>
                      <div style="font-family:${FONT_SANS};font-size:28px;font-weight:800;color:${COLORS.ink};letter-spacing:-1.2px;line-height:1;">${escapeHtml(formatVolume(stock.volume))}</div>
                      <div style="font-family:${FONT_SERIF};font-size:13px;font-style:italic;color:rgba(21,18,11,0.65);margin-top:8px;line-height:1.4;">Today's tape</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      ${sentimentBlock}
      ${targetsBlock}
      <tr>
        <td style="padding-top:14px;padding-bottom:8px;">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="border-top:1px solid rgba(21,18,11,0.16);border-bottom:1px solid rgba(21,18,11,0.16);">
            <tr>
              <td style="padding:14px 4px;font-family:${FONT_MONO};font-size:12px;letter-spacing:1.2px;color:rgba(21,18,11,0.7);font-weight:700;">
                <strong style="color:${COLORS.ink};">${escapeHtml(formatPrice(stock.last))}</strong> &nbsp;·&nbsp; <span style="color:${COLORS.goldDeep};">${escapeHtml(formatChange(stock.change_pct))}</span> &nbsp;·&nbsp; VOL ${escapeHtml(formatVolume(stock.volume))} &nbsp;·&nbsp; MCAP ${escapeHtml(stock.market_cap || "—")}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function renderAlsoOnBoardHeader(remaining: number): string {
  if (remaining <= 0) return "";
  return `<tr>
  <td class="px" style="padding:56px 40px 0;font-family:${FONT_SANS};">
    <div style="border-top:2px solid ${COLORS.gold};padding-top:24px;font-family:${FONT_MONO};font-size:11px;letter-spacing:1.8px;color:${COLORS.goldDeep};font-weight:700;margin-bottom:14px;">
      ALSO ON THE BOARD · 02–${String(1 + remaining).padStart(2, "0")}
    </div>
    <h2 class="h2" style="margin:0;font-family:${FONT_SANS};font-size:36px;line-height:1;letter-spacing:-1.2px;font-weight:800;color:${COLORS.ink};">
      ${remaining === 1 ? "One more name" : `${spelledNumber(remaining)} more names`}<br/>
      <span style="font-family:${FONT_SERIF};font-style:italic;font-weight:500;">we're watching live.</span>
    </h2>
  </td>
</tr>`;
}

function spelledNumber(n: number): string {
  const map: Record<number, string> = { 1: "One", 2: "Two", 3: "Three", 4: "Four", 5: "Five" };
  return map[n] ?? String(n);
}

function renderCompactStock(num: number, stock: MorningEmailStock, isLast: boolean): string {
  const numStr = String(num).padStart(2, "0");
  const borderStyle = isLast
    ? "border-top:1px solid rgba(21,18,11,0.16);border-bottom:1px solid rgba(21,18,11,0.16);"
    : "border-top:1px solid rgba(21,18,11,0.16);";
  const riskFlagsLine = stock.risk_flags.length > 0
    ? `<div style="margin-top:10px;font-family:${FONT_MONO};font-size:10px;letter-spacing:1.2px;color:${COLORS.goldDeep};font-weight:700;">▲ ${escapeHtml(stock.risk_flags.join(" · ").toUpperCase())}</div>`
    : "";

  return `<tr>
  <td class="px" style="padding:${num === 2 ? "36px 40px 0" : "0 40px"};">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="${borderStyle}">
      <tr>
        <td style="padding:24px 0 0;">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
            <tr>
              <td valign="top" width="92" style="padding-right:8px;">
                <div class="stock-num" style="font-family:${FONT_SANS};font-size:72px;font-weight:800;color:${COLORS.goldDeep};letter-spacing:-3.6px;line-height:0.85;">${numStr}</div>
              </td>
              <td valign="top" style="padding-top:8px;">
                <div class="stock-ticker" style="font-family:${FONT_SANS};font-size:42px;font-weight:800;color:${COLORS.ink};letter-spacing:-1.8px;line-height:0.95;">${escapeHtml(stock.ticker)} <span style="color:${COLORS.goldDeep};font-size:24px;letter-spacing:-0.6px;">${escapeHtml(formatChange(stock.change_pct))}</span></div>
                <div style="font-family:${FONT_SERIF};font-style:italic;font-size:15px;color:rgba(21,18,11,0.65);margin-top:6px;line-height:1.35;">${escapeHtml(stock.name || "")}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 0 0;">
          ${renderCatalystBody(stock, { headlineSize: 16, bodySize: 16, pBottom: 12 })}
          ${riskFlagsLine}
        </td>
      </tr>
      ${renderCompactTargets(stock)}
      <tr>
        <td style="padding:18px 0 28px;">
          <div style="font-family:${FONT_MONO};font-size:12px;letter-spacing:1.2px;color:rgba(21,18,11,0.7);font-weight:700;">
            <strong style="color:${COLORS.ink};">${escapeHtml(formatPrice(stock.last))}</strong> &nbsp;·&nbsp; <span style="color:${COLORS.goldDeep};">${escapeHtml(formatChange(stock.change_pct))}</span> &nbsp;·&nbsp; VOL ${escapeHtml(formatVolume(stock.volume))} &nbsp;·&nbsp; MCAP ${escapeHtml(stock.market_cap || "—")}
          </div>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function renderSignoff(closing1: string, closing2: string): string {
  const c1 = (closing1 || "").trim();
  const c2 = (closing2 || "").trim();
  return `<tr>
  <td class="px" style="padding:48px 40px 0;font-family:${FONT_SERIF};font-size:17px;line-height:1.6;color:${COLORS.ink};">
    <div style="font-family:${FONT_MONO};font-size:11px;letter-spacing:1.5px;color:${COLORS.goldDeep};font-weight:700;margin-bottom:18px;">→ ONE MORE THING</div>
    ${escapeHtml(c1).replace(/\n\n/g, "<br/><br/>").replace(/\n/g, "<br/>")}
  </td>
</tr>
<tr>
  <td class="px" style="padding:28px 40px 0;font-family:${FONT_SERIF};font-size:16px;line-height:1.5;color:${COLORS.ink};">
    <span style="font-family:${FONT_SERIF};font-style:italic;font-size:16px;color:${COLORS.ink};">Rob, Pedro, and Buddy</span>
    <br/>
    <span style="font-family:${FONT_MONO};font-size:11px;letter-spacing:1.5px;color:rgba(21,18,11,0.55);">— the Longboard Editorial Team</span>
  </td>
</tr>`;
}

function renderDisclaimer(): string {
  return `<tr>
  <td class="px" style="padding:32px 40px 32px;">
    <div style="background:${COLORS.cream};padding:18px 22px;font-family:${FONT_SERIF};font-size:13px;line-height:1.55;color:rgba(21,18,11,0.7);">
      <span style="font-family:${FONT_MONO};font-size:10px;letter-spacing:1.5px;color:${COLORS.goldDeep};font-weight:700;">⚠ NOT FINANCIAL ADVICE</span><br/>
      <span style="display:inline-block;margin-top:6px;">All trading involves risk. Past performance is not indicative of future results. Always do your own research before entering any position.</span>
    </div>
  </td>
</tr>`;
}

function renderFooter(): string {
  return `<tr>
  <td style="padding:24px 40px 28px;background:${COLORS.ink};color:rgba(244,241,232,0.55);font-family:${FONT_MONO};font-size:11px;letter-spacing:1px;line-height:1.7;">
    <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0">
      <tr>
        <td align="left" style="color:rgba(244,241,232,0.8);">
          <span style="display:inline-block;width:20px;height:20px;background:${COLORS.gold};color:${COLORS.ink};text-align:center;font-weight:900;font-family:${FONT_SANS};font-size:12px;line-height:20px;vertical-align:middle;margin-right:6px;">L</span>
          <span style="vertical-align:middle;font-family:${FONT_SANS};font-weight:700;letter-spacing:-0.3px;font-size:13px;color:${COLORS.paper};">LONGBOARD<span style="color:${COLORS.gold};font-style:italic;">AI</span></span>
        </td>
        <td align="right" style="color:rgba(244,241,232,0.55);">
          MORNING BRIEF
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

export function buildEmailHtml(draft: MorningEmailDraft, opts: { dateLabel?: string } = {}): string {
  const dateLabel = opts.dateLabel ?? chicagoDateLabel();
  const stocks = draft.stocks;
  const top = stocks[0];
  const rest = stocks.slice(1);
  const preheader = defaultPreheader(top, stocks.length);
  const subjectKicker = (draft.subject || "Morning Movers").trim();

  const compact = rest
    .map((s, i) => renderCompactStock(i + 2, s, i === rest.length - 1))
    .join("\n");

  return `${renderHead(subjectKicker, dateLabel)}
<body style="margin:0;padding:0;background:${COLORS.bg};">

<div style="display:none;font-size:1px;color:${COLORS.bg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;font-family:${FONT_SANS};">
  ${escapeHtml(preheader)}
</div>

<center style="width:100%;background:${COLORS.bg};">
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="background:${COLORS.bg};">
  <tr>
    <td align="center" style="padding:32px 16px;">

      <table role="presentation" class="container" width="600" border="0" cellspacing="0" cellpadding="0" style="width:600px;max-width:600px;background:${COLORS.body};border:1px solid rgba(21,18,11,0.14);">
        ${renderHeader(dateLabel)}
        ${renderHero(subjectKicker, stocks.length)}
        ${renderIntro()}
        ${renderMarketPulse(stocks)}
        ${top ? renderTopPickHeader() : ""}
        ${top ? renderTopPick(top) : ""}
        ${renderAlsoOnBoardHeader(rest.length)}
        ${compact}
        ${renderSignoff(draft.closing1, draft.closing2)}
        ${renderDisclaimer()}
        ${renderFooter()}
      </table>

    </td>
  </tr>
</table>
</center>

</body>
</html>`;
}
