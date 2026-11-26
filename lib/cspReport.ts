// #519 What /api/csp-report keeps from a browser's "this would have been blocked" report.
// Reports arrive from anyone's browser with no sign-in, so everything here is defensive: small
// bodies only, only the fields we need, addresses cut down to scheme + host + path (a query
// string or fragment can carry a sign-in token or a signed storage link), browser-extension
// noise dropped, and repeats of the same finding logged once per window.

/** A few KB is plenty for a real report; anything larger is dropped unread. */
export const CSP_REPORT_MAX_BODY = 8 * 1024;
/** One `application/reports+json` batch may carry several reports; keep the first few. */
export const CSP_REPORT_MAX_PER_BATCH = 10;
/** The fixed start of every log line: search the logs for this. */
export const CSP_REPORT_LOG_PREFIX = "csp-report";

export type CspReportLine = { doc: string; directive: string; blocked: string; source?: string; line?: number; mode: string };

/** Extension and browser-internal schemes; some browsers send only the scheme name. */
const NOISE = /^(chrome|chrome-extension|moz-extension|safari-extension|safari-web-extension|ms-browser-extension|webkit-masked-url|about|resource|edge|opera|brave|vivaldi|file|view-source|javascript)(:|$)/i;
/** Values browsers send in place of an address. */
const KEYWORD = /^(inline|eval|wasm-eval|self|data|blob|filesystem|mediastream|trusted-types-policy|trusted-types-sink|unknown)$/i;
const DIRECTIVE = /^[a-z][a-z-]{2,40}$/;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** scheme + host + path only; `data:`/`blob:` become just the scheme; keywords pass through. */
export function cspReportUrl(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  if (KEYWORD.test(raw)) return raw.toLowerCase();
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (scheme && !["http", "https", "ws", "wss"].includes(scheme)) return `${scheme}:`;
  try {
    // A bare host or path (some browsers send only the origin) is kept without query/fragment.
    if (!scheme) return raw.split(/[?#]/)[0].slice(0, 200);
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 300);
  } catch {
    return "";
  }
}

const isNoise = (value: unknown) => NOISE.test(text(value));

/** One report body (either format's field names) to a log line, or null when it is dropped. */
export function cspReportLine(body: unknown, siteHost: string | null): CspReportLine | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const rawDoc = b["document-uri"] ?? b.documentURL;
  const rawBlocked = b["blocked-uri"] ?? b.blockedURL;
  const rawSource = b["source-file"] ?? b.sourceFile;
  const directive = text(b["effective-directive"] ?? b.effectiveDirective ?? b["violated-directive"]).split(/\s+/)[0].toLowerCase();
  if (!DIRECTIVE.test(directive)) return null;
  // Extensions and browser-internal pages inject their own scripts and styles: not ours to fix.
  if (isNoise(rawDoc) || isNoise(rawBlocked) || isNoise(rawSource)) return null;
  const doc = cspReportUrl(rawDoc);
  if (!/^https?:\/\//.test(doc)) return null;
  // A real report is about one of this site's own pages.
  if (siteHost && new URL(doc).host.toLowerCase() !== siteHost.toLowerCase()) return null;
  const blocked = cspReportUrl(rawBlocked);
  if (!blocked) return null;
  const line: CspReportLine = { doc, directive, blocked, mode: text(b.disposition) === "enforce" ? "enforce" : "report" };
  const source = cspReportUrl(rawSource);
  if (source) line.source = source;
  const lineNumber = Number(b["line-number"] ?? b.lineNumber);
  if (Number.isInteger(lineNumber) && lineNumber > 0) line.line = lineNumber;
  return line;
}

/**
 * Both formats: `application/csp-report` is `{"csp-report": {...}}`; `application/reports+json`
 * is a list of `{type: "csp-violation", body: {...}}`. Anything else gives an empty list.
 */
export function parseCspReports(raw: string, siteHost: string | null): CspReportLine[] {
  if (!raw || raw.length > CSP_REPORT_MAX_BODY) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const bodies: unknown[] = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed.slice(0, CSP_REPORT_MAX_PER_BATCH))
      if (item && typeof item === "object" && (item as Record<string, unknown>).type === "csp-violation") bodies.push((item as Record<string, unknown>).body);
  } else if (parsed && typeof parsed === "object") {
    const one = parsed as Record<string, unknown>;
    if (one["csp-report"]) bodies.push(one["csp-report"]);
    else if (one.type === "csp-violation") bodies.push(one.body);
  }
  const lines: CspReportLine[] = [];
  for (const body of bodies) {
    try {
      const line = cspReportLine(body, siteHost);
      if (line) lines.push(line);
    } catch {}
  }
  return lines;
}

/**
 * Keeps a busy page from flooding the logs: the same finding (rule + blocked address + page) is
 * logged once per window per server instance; later copies are counted, not written.
 */
export class CspReportSampler {
  private seen = new Map<string, number>();
  constructor(
    private windowMs = 10 * 60_000,
    private maxKeys = 2_000,
  ) {}
  shouldLog(line: CspReportLine, now = Date.now()): boolean {
    const key = `${line.directive}|${line.blocked}|${line.doc}|${line.source ?? ""}`;
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;
    if (this.seen.size >= this.maxKeys) {
      for (const [k, at] of this.seen) if (now - at >= this.windowMs) this.seen.delete(k);
      // Full of fresh, different findings: stop writing until the window moves on.
      if (this.seen.size >= this.maxKeys) return false;
    }
    this.seen.set(key, now);
    return true;
  }
}
