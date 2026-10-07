import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { CHAT_UUID } from "./chatMembers";
import { isPaidShortScoutLevel } from "./shortscoutPolicy";

const ENDPOINT = "https://xejuximbbpnzqylukrsn.supabase.co/functions/v1/chat-membership-export";
export type ShortScoutAuthorization =
  { state: "allow"; level: string } | { state: "deny"; level: null } | { state: "unavailable"; level: null };
type Options = { key: () => string | undefined; request?: typeof fetch; now?: () => number };
const sign = (key: string, text: string) => createHmac("sha256", key).update(text).digest("hex");

/** Exact authorization-purpose response. Badge results are never accepted here.
 * The database owns the 60-second proof deadline and cross-instance ordering.
 */
export function createShortScoutAuthorizationVerifier({ key, request = fetch, now = Date.now }: Options) {
  return async (subject: string): Promise<ShortScoutAuthorization> => {
    const secret = key();
    if (
      !secret ||
      Buffer.byteLength(secret) < 32 ||
      !CHAT_UUID.test(subject) ||
      subject !== subject.toLowerCase()
    )
      return { state: "unavailable", level: null };
    const started = now(),
      stamp = String(Math.floor(started / 1000)),
      nonce = randomBytes(16).toString("hex");
    const body = JSON.stringify({ version: 2, purpose: "chat-authorization", subjects: [subject] });
    try {
      const response = await request(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-chat-membership-timestamp": stamp,
          "x-chat-membership-nonce": nonce,
          "x-chat-membership-signature": sign(secret, `request\n${stamp}\n${nonce}\n${body}`),
        },
        body,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (response.status !== 200 || !response.body) throw Error("unavailable");
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 65536) throw Error("oversize");
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => {});
      }
      const raw = Buffer.concat(chunks).toString("utf8"),
        timestamp = response.headers.get("x-chat-membership-timestamp") ?? "",
        mac = response.headers.get("x-chat-membership-signature") ?? "";
      if (
        key() !== secret ||
        now() - started >= 5000 ||
        !/^\d{10}$/.test(timestamp) ||
        Math.abs(now() - Number(timestamp) * 1000) > 60000 ||
        !/^[a-f0-9]{64}$/.test(mac)
      )
        throw Error("stale");
      if (
        !timingSafeEqual(
          Buffer.from(mac, "hex"),
          Buffer.from(sign(secret, `response\n${timestamp}\n${nonce}\n${raw}`), "hex"),
        )
      )
        throw Error("signature");
      const value = JSON.parse(raw);
      if (
        !value ||
        Object.keys(value).sort().join(",") !== "nonce,purpose,records,requestDigest,version" ||
        value.version !== 2 ||
        value.purpose !== "chat-authorization" ||
        value.nonce !== nonce ||
        value.requestDigest !== createHash("sha256").update(body).digest("hex") ||
        !Array.isArray(value.records) ||
        value.records.length !== 1
      )
        throw Error("envelope");
      const record = value.records[0];
      if (
        !record ||
        Object.keys(record).sort().join(",") !== "level,state,subject" ||
        record.subject !== subject
      )
        throw Error("subject");
      if (record.state === "allow" && isPaidShortScoutLevel(record.level))
        return { state: "allow", level: record.level };
      if (record.state === "deny" && record.level === null) return { state: "deny", level: null };
      throw Error("decision");
    } catch {
      return { state: "unavailable", level: null };
    }
  };
}
export const verifyCurrentShortScoutAuthorization = createShortScoutAuthorizationVerifier({
  key: () => process.env.CHAT_MEMBERSHIP_EXPORT_KEY,
});
