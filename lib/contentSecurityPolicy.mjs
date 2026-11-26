// #519 Content security policy, WATCH-ONLY stage.
//
// The site sends `Content-Security-Policy-Report-Only` on its pages: a browser checks every rule
// and reports what the policy WOULD have blocked (to /api/csp-report), and blocks nothing. This
// file never produces the enforcing `Content-Security-Policy` header.
//
// Plain JavaScript on purpose: next.config.mjs imports it when the app is built, so the header is
// a fixed string in the routes table. Nothing runs per request, no page is made dynamic and no
// cache header changes. Host names come from settings that are already public (or, for LiveKit,
// a wss:// host name that every stage viewer's browser is handed anyway). Never a key or token.

export const CSP_REPORT_PATH = "/api/csp-report";
export const CSP_REPORT_GROUP = "csp-endpoint";
export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";

/**
 * Which addresses carry the header: pages only. Not /api/* (JSON, and the attachment download
 * route that sends its own enforcing `sandbox` policy), not /_next/* (scripts, styles, images),
 * and not a file with an extension (pictures, the service workers, feeds, the web manifest),
 * except the handful of plain .html pages in public/.
 */
export const CSP_PAGE_SOURCE = "/((?!api/|_next/)(?!.*\\.(?!html$)[A-Za-z0-9]+$).*)";

/** @typedef {Record<string, string | undefined>} Env */

/**
 * `https://host[:port]` of a URL setting, or null when it is missing or not a web address.
 * @param {string | undefined} value
 */
function httpOrigin(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim().replace(/^ws/i, "http"));
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    // A host name only: no path, no query and no sign-in part can reach the header.
    return /^[A-Za-z0-9.:[\]-]+$/.test(url.host) ? `${url.protocol}//${url.host}` : null;
  } catch {
    return null;
  }
}
/** @param {string} origin */
const socketOrigin = (origin) => origin.replace(/^http/, "ws");

/**
 * `CSP_REPORT_ONLY=off` removes the header at the next deploy. A local `next dev` never sends it.
 * @param {Env} [env]
 */
export function cspReportOnlyEnabled(env = process.env) {
  const flag = String(env.CSP_REPORT_ONLY ?? "").trim().toLowerCase();
  if (["off", "0", "false", "no"].includes(flag)) return false;
  // `next dev` uses eval for hot reload; a policy without 'unsafe-eval' would only report noise.
  return env.NODE_ENV === "production";
}

/**
 * The rules, in order, as [directive, sources[]]. Each line says why it is there.
 * @param {Env} [env]
 */
export function cspDirectives(env = process.env) {
  const supabase = httpOrigin(env.NEXT_PUBLIC_SUPABASE_URL);
  const liveKit = httpOrigin(env.LIVEKIT_URL);
  const oneSignal = Boolean(String(env.NEXT_PUBLIC_ONESIGNAL_APP_ID ?? "").trim());
  // Vercel adds its comment toolbar to preview deployments only; production never loads it.
  const preview = env.VERCEL_ENV === "preview";
  /** @param {...(string | false | null | (string | false | null)[])} groups @returns {string[]} */
  const list = (...groups) => /** @type {string[]} */ (groups.flat().filter(Boolean));

  // LiveKit Cloud moves a viewer between regional hosts under the same domain, so the wildcard
  // is needed even when the project host is known. A self-hosted address is added exactly.
  const liveKitSources = ["https://*.livekit.cloud", "wss://*.livekit.cloud"];
  if (liveKit && !/\.livekit\.cloud(:\d+)?$/i.test(liveKit)) liveKitSources.push(liveKit, socketOrigin(liveKit));

  /** @type {[string, string[]][]} */
  const rules = [
    // Anything not named below may only come from this site.
    ["default-src", ["'self'"]],
    // An injected <base> tag cannot re-point the page's relative links.
    ["base-uri", ["'self'"]],
    // No plugins (Flash, Java, embedded PDFs): the site uses none.
    ["object-src", ["'none'"]],
    // Only this site may put its pages in a frame (Command 2 frames /chat); nobody else can.
    ["frame-ancestors", ["'self'"]],
    // The app's own code, the inline scripts Next.js and the theme/chat start-up need, Google
    // Analytics, and OneSignal when it is configured. No 'unsafe-eval'.
    [
      "script-src",
      list(
        "'self'",
        "'unsafe-inline'",
        "https://www.googletagmanager.com",
        oneSignal && ["https://cdn.onesignal.com", "https://api.onesignal.com"],
        preview && "https://vercel.live",
      ),
    ],
    // The app's styles, inline styles (used throughout), the Reader's book styles (blob:),
    // Google Fonts' stylesheet, and OneSignal's prompt styles when it is configured.
    [
      "style-src",
      list(
        "'self'",
        "'unsafe-inline'",
        "blob:",
        "https://fonts.googleapis.com",
        oneSignal && "https://onesignal.com",
        preview && "https://vercel.live",
      ),
    ],
    // The site's own fonts, Google Fonts' files, and fonts packed inside a Reader book.
    [
      "font-src",
      list("'self'", "data:", "blob:", "https://fonts.gstatic.com", preview && ["https://vercel.live", "https://assets.vercel.com"]),
    ],
    // Site pictures, inline and preview pictures (data:, blob:), storage (profile pictures,
    // attachments, book covers), GIPHY, TradingView chart snapshots, the podcast cover, and the
    // picture Google Analytics uses as a fallback beacon.
    [
      "img-src",
      list(
        "'self'",
        "data:",
        "blob:",
        supabase,
        "https://media.giphy.com",
        "https://media0.giphy.com",
        "https://media1.giphy.com",
        "https://media2.giphy.com",
        "https://media3.giphy.com",
        "https://media4.giphy.com",
        "https://s3.tradingview.com",
        "https://audio.longboardai.com",
        "https://*.google-analytics.com",
        "https://*.googletagmanager.com",
        oneSignal && "https://img.onesignal.com",
        preview && ["https://vercel.live", "https://vercel.com"],
      ),
    ],
    // Voice messages (storage), essay audio, and audio played from memory (radio, recorder).
    ["media-src", list("'self'", "blob:", supabase, "https://audio.longboardai.com")],
    // Frames: this site, the Reader's book frame (blob:), and any https page, because admins
    // can add any https page as a chat sidebar tab. Tightening this is a later stage.
    ["frame-src", ["'self'", "blob:", "https:"]],
    // Where the page may send or fetch data: this site, storage and live updates (Supabase),
    // Ably, LiveKit, GIPHY search, the ShortScout sign-in hand-off, Google Analytics, and
    // OneSignal when it is configured.
    [
      "connect-src",
      list(
        "'self'",
        "blob:",
        supabase && [supabase, socketOrigin(supabase)],
        "https://*.ably.net",
        "wss://*.ably.net",
        "https://*.ably-realtime.com",
        "wss://*.ably-realtime.com",
        liveKitSources,
        "https://api.giphy.com",
        // The chat's "link ShortScout" sign-in address answers with a redirect to ShortScout, and
        // the browser checks where a pre-loaded link ends up.
        "https://shortscout.ai",
        "https://*.google-analytics.com",
        "https://*.analytics.google.com",
        "https://*.googletagmanager.com",
        oneSignal && ["https://cdn.onesignal.com", "https://api.onesignal.com", "https://onesignal.com"],
        preview && ["https://vercel.live", "wss://ws-us3.pusher.com"],
      ),
    ],
    // The chat's and OneSignal's service workers, and workers a library starts from memory.
    ["worker-src", ["'self'", "blob:"]],
    // The chat app's install manifest.
    ["manifest-src", ["'self'"]],
    // Forms may only post back to this site.
    ["form-action", ["'self'"]],
    // Where browsers send what they would have blocked: the old way and the new way.
    ["report-uri", [CSP_REPORT_PATH]],
    ["report-to", [CSP_REPORT_GROUP]],
  ];
  return rules;
}

/**
 * The header value: `name source source; name source; ...`.
 * @param {Env} [env]
 */
export function buildContentSecurityPolicy(env = process.env) {
  return cspDirectives(env)
    .map(([name, sources]) => `${name} ${[...new Set(sources)].join(" ")}`)
    .join("; ");
}

/**
 * The entries for next.config's `headers()`: none when the switch is off or in `next dev`.
 * @param {Env} [env]
 */
export function cspReportOnlyHeaders(env = process.env) {
  if (!cspReportOnlyEnabled(env)) return [];
  return [
    {
      source: CSP_PAGE_SOURCE,
      headers: [
        { key: CSP_REPORT_ONLY_HEADER, value: buildContentSecurityPolicy(env) },
        { key: "Reporting-Endpoints", value: `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` },
      ],
    },
  ];
}
