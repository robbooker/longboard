import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CSP_REPORT_MAX_BODY, CspReportSampler, cspReportUrl, parseCspReports } from "../cspReport";

const SITE = "https://longboard.test";
let ip = 0;
function post(body: string, type = "application/csp-report", forwarded = `10.1.0.${++ip}`, extra: Record<string, string> = {}) {
  return new NextRequest(`${SITE}/api/csp-report`, { method: "POST", headers: { "Content-Type": type, "x-forwarded-for": forwarded, host: "longboard.test", ...extra }, body });
}
const legacy = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    "csp-report": {
      "document-uri": `${SITE}/chat?room=main&token=SECRET#frag`,
      referrer: `${SITE}/login?next=/chat&code=SECRET`,
      "violated-directive": "img-src",
      "effective-directive": "img-src",
      "original-policy": "default-src 'self'; report-uri /api/csp-report",
      disposition: "report",
      "blocked-uri": "https://cdn.example.com/pic.png?sig=SECRET",
      "source-file": `${SITE}/_next/static/chunks/app.js?dpl=SECRET`,
      "line-number": 12,
      "script-sample": "SECRET sample",
      ...over,
    },
  });
const modern = (bodies: Record<string, unknown>[]) =>
  JSON.stringify(bodies.map((body) => ({ type: "csp-violation", age: 3, url: `${SITE}/chat?token=SECRET`, user_agent: "UA", body })));
const modernBody = (over: Record<string, unknown> = {}) => ({
  documentURL: `${SITE}/learn?utm=SECRET`,
  referrer: "",
  blockedURL: "wss://socket.example.com/live?access_token=SECRET",
  effectiveDirective: "connect-src",
  originalPolicy: "default-src 'self'",
  sourceFile: `${SITE}/_next/static/chunks/x.js?v=SECRET`,
  lineNumber: 7,
  disposition: "report",
  statusCode: 200,
  ...over,
});

let log: ReturnType<typeof vi.spyOn>;
const lines = () => log.mock.calls.map((call: unknown[]) => String(call[0]));
beforeEach(() => {
  vi.resetModules();
  log = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => log.mockRestore());

describe("POST /api/csp-report", () => {
  it("accepts the older report format and logs one compact line without query strings", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const response = await POST(post(legacy()));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(lines()).toEqual([
      `csp-report ${JSON.stringify({ doc: `${SITE}/chat`, directive: "img-src", blocked: "https://cdn.example.com/pic.png", mode: "report", source: `${SITE}/_next/static/chunks/app.js`, line: 12 })}`,
    ]);
    expect(lines().join()).not.toMatch(/SECRET|\?|#|referrer|original-policy|sample/);
  });

  it("accepts the newer report format, several reports in one post", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const response = await POST(post(modern([modernBody(), modernBody({ blockedURL: "inline", effectiveDirective: "script-src-elem", sourceFile: undefined, lineNumber: undefined })]), "application/reports+json; charset=utf-8"));
    expect(response.status).toBe(204);
    expect(lines()).toEqual([
      `csp-report ${JSON.stringify({ doc: `${SITE}/learn`, directive: "connect-src", blocked: "wss://socket.example.com/live", mode: "report", source: `${SITE}/_next/static/chunks/x.js`, line: 7 })}`,
      `csp-report ${JSON.stringify({ doc: `${SITE}/learn`, directive: "script-src-elem", blocked: "inline", mode: "report" })}`,
    ]);
    expect(lines().join()).not.toContain("SECRET");
  });

  it("drops browser-extension and browser-internal noise", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    for (const over of [
      { "blocked-uri": "chrome-extension://abcdef/content.js" },
      { "source-file": "moz-extension://abcdef/inject.js" },
      { "source-file": "safari-web-extension://abcdef/inject.js" },
      { "document-uri": "about:blank" },
      { "blocked-uri": "about" },
      { "source-file": "webkit-masked-url://hidden/" },
      { "document-uri": "https://some-other-site.example/page" },
    ])
      expect((await POST(post(legacy(over)))).status).toBe(204);
    expect((await POST(post(modern([modernBody({ sourceFile: "chrome-extension://x/y.js" })]), "application/reports+json"))).status).toBe(204);
    expect(lines()).toEqual([]);
  });

  it("drops anything that is not a CSP report, quietly", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    for (const [body, type] of [
      ["not json", "application/csp-report"],
      ["{}", "application/csp-report"],
      ["[]", "application/reports+json"],
      ['{"csp-report":"x"}', "application/csp-report"],
      ['{"csp-report":{"document-uri":"https://longboard.test/","blocked-uri":"https://a.example/"}}', "application/csp-report"],
      ['[{"type":"deprecation","body":{"id":"x"}}]', "application/reports+json"],
      [legacy({ "effective-directive": "<script>alert(1)</script>" }), "application/csp-report"],
      [legacy(), "text/plain"],
      [legacy(), "multipart/form-data"],
      ["", "application/csp-report"],
    ] as const)
      expect((await POST(post(body || " ", type))).status).toBe(204);
    expect(lines()).toEqual([]);
  });

  it("rejects big bodies, declared or not", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    const big = legacy({ "script-sample": "x".repeat(CSP_REPORT_MAX_BODY) });
    expect((await POST(post(big))).status).toBe(204);
    expect((await POST(post(legacy(), "application/csp-report", "10.2.0.1", { "content-length": String(CSP_REPORT_MAX_BODY + 1) }))).status).toBe(204);
    // A wrong (small) Content-Length does not get a big body through.
    expect((await POST(post(big, "application/csp-report", "10.2.0.2", { "content-length": "10" }))).status).toBe(204);
    expect(lines()).toEqual([]);
  });

  it("limits each caller and logs a repeated finding once", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    for (let i = 0; i < 40; i++) expect((await POST(post(legacy({ "blocked-uri": `https://h${i}.example.com/a.png` }), "application/csp-report", "10.3.0.1"))).status).toBe(204);
    expect(lines().length).toBe(30);
    // Another caller is not held back, but the same finding is not written twice.
    await POST(post(legacy({ "blocked-uri": "https://h0.example.com/a.png?other=1" }), "application/csp-report", "10.3.0.2"));
    expect(lines().length).toBe(30);
    await POST(post(legacy({ "blocked-uri": "https://new.example.com/a.png" }), "application/csp-report", "10.3.0.2"));
    expect(lines().length).toBe(31);
  });

  it("never throws", async () => {
    const { POST } = await import("@/app/api/csp-report/route");
    log.mockImplementation(() => {
      throw new Error("log failed");
    });
    expect((await POST(post(legacy()))).status).toBe(204);
    expect((await POST(new NextRequest(`${SITE}/api/csp-report`, { method: "POST" }))).status).toBe(204);
  });
});

describe("report clean-up", () => {
  it("cuts addresses down to scheme, host and path", () => {
    expect(cspReportUrl("https://x.supabase.co/storage/v1/object/sign/a/b.png?token=abc#f")).toBe("https://x.supabase.co/storage/v1/object/sign/a/b.png");
    expect(cspReportUrl("https://user:pw@host.example/p?q=1")).toBe("https://host.example/p");
    expect(cspReportUrl("data:image/png;base64,AAAA")).toBe("data:");
    expect(cspReportUrl("blob:https://longboard.test/1234-uuid")).toBe("blob:");
    expect(cspReportUrl("inline")).toBe("inline");
    expect(cspReportUrl("eval")).toBe("eval");
    expect(cspReportUrl("host.example/path?x=1")).toBe("host.example/path");
    expect(cspReportUrl(undefined)).toBe("");
    expect(cspReportUrl(42)).toBe("");
  });

  it("keeps at most ten reports from one post", () => {
    const many = modern(Array.from({ length: 12 }, (_, i) => modernBody({ blockedURL: `https://h${i}.example.com/` })));
    expect(many.length).toBeLessThan(CSP_REPORT_MAX_BODY);
    expect(parseCspReports(many, "longboard.test").length).toBe(10);
  });

  it("logs a finding again after the window", () => {
    const sampler = new CspReportSampler(1000, 2);
    const line = { doc: "https://a/", directive: "img-src", blocked: "https://b/", mode: "report" };
    expect(sampler.shouldLog(line, 0)).toBe(true);
    expect(sampler.shouldLog(line, 500)).toBe(false);
    expect(sampler.shouldLog(line, 1000)).toBe(true);
    expect(sampler.shouldLog({ ...line, blocked: "https://c/" }, 1100)).toBe(true);
    // Full of fresh findings: nothing more is written until the window moves on.
    expect(sampler.shouldLog({ ...line, blocked: "https://d/" }, 1200)).toBe(false);
    expect(sampler.shouldLog({ ...line, blocked: "https://d/" }, 2300)).toBe(true);
  });
});
