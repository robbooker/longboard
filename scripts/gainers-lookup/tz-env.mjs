// TradeZero's key file, read the same way by the borrow lookup (lookup.mjs, #373) and the Trading Desk
// feed (scripts/trading-desk-feed, #469). Just the parsing: it never opens a file, sends anything or
// prints a value. Node 22+, no packages.

/** TradeZero's key, secret and account from an env file's text, in either naming. Never printed. */
export function readTradeZeroEnv(text) {
  const env = {};
  for (const raw of String(text).split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const at = line.indexOf("=");
    env[line.slice(0, at).trim().replace(/^export\s+/, "")] = line.slice(at + 1).trim().replace(/^["']|["']$/g, "");
  }
  const pick = (...names) => names.map((name) => env[name]).find((value) => value) || "";
  return {
    keyId: pick("TRADEZERO_API_KEY_ID", "TZ_API_KEY_ID"),
    secret: pick("TRADEZERO_API_SECRET_KEY", "TZ_API_SECRET_KEY", "TZ_API_SECRET"),
    accountId: pick("TRADEZERO_ACCOUNT_ID", "TZ_ACCOUNT_ID"),
    baseUrl: pick("TRADEZERO_API_BASE_URL", "TZ_API_BASE_URL") || undefined,
  };
}
