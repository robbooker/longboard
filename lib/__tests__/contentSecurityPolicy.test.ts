import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CSP_PAGE_SOURCE,
  CSP_REPORT_ONLY_HEADER,
  buildContentSecurityPolicy,
  cspDirectives,
  cspReportOnlyEnabled,
  cspReportOnlyHeaders,
} from "../contentSecurityPolicy.mjs";
import { INERT_DOWNLOAD_CSP } from "../chatAttachmentDownload";

const prod = { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://abcd1234.supabase.co/", VERCEL_ENV: "production" };
const rule = (env: Record<string, string | undefined>, name: string) => cspDirectives(env).find(([n]) => n === name)?.[1] ?? [];

describe("#519 watch-only content security policy", () => {
  it("is only ever the Report-Only header, with both report addresses", () => {
    const [entry, ...rest] = cspReportOnlyHeaders(prod);
    expect(rest).toEqual([]);
    expect(entry.headers.map((h) => h.key)).toEqual(["Content-Security-Policy-Report-Only", "Reporting-Endpoints"]);
    expect(CSP_REPORT_ONLY_HEADER).toBe("Content-Security-Policy-Report-Only");
    expect(entry.headers[1].value).toBe('csp-endpoint="/api/csp-report"');
    expect(entry.headers[0].value).toContain("report-uri /api/csp-report; report-to csp-endpoint");
    expect(entry.headers[0].value).not.toMatch(/[\r\n]/);
  });

  it("never allows eval and keeps framing to this site", () => {
    const policy = buildContentSecurityPolicy({ ...prod, NEXT_PUBLIC_ONESIGNAL_APP_ID: "x", LIVEKIT_URL: "wss://a.livekit.cloud", VERCEL_ENV: "preview" });
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).toContain("frame-ancestors 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(rule(prod, "script-src")).not.toContain("https:");
  });

  it("uses the configured Supabase host for pictures, audio, requests and live updates", () => {
    for (const name of ["img-src", "media-src", "connect-src"]) expect(rule(prod, name)).toContain("https://abcd1234.supabase.co");
    expect(rule(prod, "connect-src")).toContain("wss://abcd1234.supabase.co");
    // The local test fixture is plain http on a port.
    const local = { ...prod, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54404" };
    expect(rule(local, "connect-src")).toEqual(expect.arrayContaining(["http://127.0.0.1:54404", "ws://127.0.0.1:54404"]));
    // Missing or broken: left out, never "undefined" or a wildcard.
    for (const bad of [undefined, "", "not a url", "ftp://x.example"]) {
      const policy = buildContentSecurityPolicy({ ...prod, NEXT_PUBLIC_SUPABASE_URL: bad });
      expect(policy).not.toMatch(/undefined|null|false|ftp:|supabase/);
    }
  });

  it("covers Ably's current hosts and LiveKit", () => {
    const connect = rule(prod, "connect-src");
    expect(connect).toEqual(expect.arrayContaining(["wss://*.ably.net", "https://*.ably.net", "wss://*.ably-realtime.com", "https://*.ably-realtime.com"]));
    expect(connect).toEqual(expect.arrayContaining(["https://*.livekit.cloud", "wss://*.livekit.cloud"]));
    // A LiveKit Cloud project is already covered by the wildcard; a self-hosted one is added exactly.
    expect(rule({ ...prod, LIVEKIT_URL: "wss://proj-1.livekit.cloud" }, "connect-src")).toEqual(connect);
    expect(rule({ ...prod, LIVEKIT_URL: "wss://video.example.com/path?x=1" }, "connect-src")).toEqual(
      expect.arrayContaining(["https://video.example.com", "wss://video.example.com"]),
    );
  });

  it("puts only host names in the header, never a path, query or sign-in part", () => {
    const policy = buildContentSecurityPolicy({
      ...prod,
      NEXT_PUBLIC_SUPABASE_URL: "https://user:pass@abcd1234.supabase.co/rest?apikey=SECRET",
      LIVEKIT_URL: "wss://key:secret@video.example.com/rtc?access_token=SECRET",
      NEXT_PUBLIC_ONESIGNAL_APP_ID: "onesignal-app-id",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
    });
    expect(policy).not.toMatch(/SECRET|pass|secret|apikey|onesignal-app-id|anon-key|@/);
  });

  it("adds OneSignal only when it is configured and Vercel's toolbar only on previews", () => {
    expect(buildContentSecurityPolicy(prod)).not.toMatch(/onesignal|vercel/);
    expect(rule({ ...prod, NEXT_PUBLIC_ONESIGNAL_APP_ID: "x" }, "script-src")).toContain("https://cdn.onesignal.com");
    expect(rule({ ...prod, VERCEL_ENV: "preview" }, "script-src")).toContain("https://vercel.live");
  });

  it("has a switch, and is off in next dev", () => {
    expect(cspReportOnlyEnabled(prod)).toBe(true);
    for (const off of ["off", "OFF", " off ", "0", "false"]) {
      expect(cspReportOnlyEnabled({ ...prod, CSP_REPORT_ONLY: off })).toBe(false);
      expect(cspReportOnlyHeaders({ ...prod, CSP_REPORT_ONLY: off })).toEqual([]);
    }
    expect(cspReportOnlyEnabled({ ...prod, CSP_REPORT_ONLY: "" })).toBe(true);
    expect(cspReportOnlyHeaders({ ...prod, NODE_ENV: "development" })).toEqual([]);
    expect(cspReportOnlyHeaders({ ...prod, NODE_ENV: "test" })).toEqual([]);
  });

  it("goes on pages only: not the API, build files or other static files", () => {
    const pages = new RegExp(`^${CSP_PAGE_SOURCE}$`);
    for (const path of ["/", "/chat", "/chat/dual", "/chat/quad", "/learn", "/learn/some-essay", "/admin/morning-email/history", "/gainers/2026-11-25", "/houston", "/harada-goal-board.html", "/lab/index.html", "/login"])
      expect(pages.test(path), path).toBe(true);
    for (const path of ["/api/csp-report", "/api/chat", "/api/chat/attachments/123", "/_next/static/chunks/a.js", "/_next/image", "/chat-sw.js", "/OneSignalSDKWorker.js", "/favicon.ico", "/bubbles-illustration.png", "/podcast.xml", "/chat/manifest.webmanifest"])
      expect(pages.test(path), path).toBe(false);
  });

  it("leaves the attachment download's own blocking policy alone", () => {
    expect(INERT_DOWNLOAD_CSP).toBe("sandbox; default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    const config = readFileSync(join(__dirname, "../../next.config.mjs"), "utf8");
    // The config adds nothing but the builder's entries: no enforcing header anywhere.
    expect(config).toContain("...cspReportOnlyHeaders()");
    expect(config.match(/Content-Security-Policy/g)).toBeNull();
    expect(readFileSync(join(__dirname, "../contentSecurityPolicy.mjs"), "utf8").match(/"Content-Security-Policy"/g)).toBeNull();
  });
});
