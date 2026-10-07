import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { clarityPair, resolveClarityConversation } from "@/lib/clarity/pair";
import {
  claritySystemPrompt,
  clarityStandards,
  preserveNumbers,
  transformDraft,
  type ClarityRequest,
  type ClarityResult,
} from "@/lib/clarity/transform";
import { parseClarityPayload, saveClarityDraft } from "@/lib/clarity/drafts";

const ROB = "11111111-1111-4111-8111-111111111111";
const LIZ = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const CONVO = "44444444-4444-4444-8444-444444444444";
const PAIR = `Rob:${ROB},Liz:${LIZ}`;

function fakeDb({ member, conversation }: { member: string | null; conversation: Record<string, string> | null }) {
  const upserts: unknown[] = [];
  const db = {
    upserts,
    from(table: string) {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () =>
          table === "longboard_chat_members"
            ? { data: member ? { id: member, display_name: "x" } : null, error: null }
            : { data: conversation, error: null },
        upsert: async (row: unknown) => {
          upserts.push(row);
          return { error: null };
        },
      };
      return chain;
    },
  };
  return db as unknown as Parameters<typeof resolveClarityConversation>[0] & { upserts: unknown[] };
}
const accepted = { id: CONVO, requester_id: ROB, recipient_id: LIZ, status: "accepted" };

it("ships Liz's standards unchanged and sends all of them to the model", () => {
  const original = readFileSync("lib/clarity/COMMUNICATION_STANDARDS.md", "utf8");
  expect(clarityStandards().sha256).toBe(createHash("sha256").update(original).digest("hex"));
  const prompt = claritySystemPrompt(clarityStandards().text);
  expect(prompt.endsWith(original)).toBe(true);
  expect(prompt).toContain("section 25 when Liz writes to Rob and section 26 when Rob writes to Liz");
});

it("parses the pair strictly and disables the feature on anything malformed", () => {
  expect([...(clarityPair(PAIR)?.values() ?? [])]).toEqual(["Rob", "Liz"]);
  for (const bad of [undefined, "", `Rob:${ROB}`, `Rob:${ROB},Rob:${LIZ}`, `Bob:${ROB},Liz:${LIZ}`, `Rob:not-a-uuid,Liz:${LIZ}`])
    expect(clarityPair(bad)).toBeNull();
});

it("derives sender and recipient from the signed-in member and the verified DM", async () => {
  const pair = clarityPair(PAIR);
  expect(await resolveClarityConversation(fakeDb({ member: ROB, conversation: accepted }), "acct", CONVO, pair)).toEqual({
    conversationId: CONVO,
    senderMemberId: ROB,
    sender: "Rob",
    recipient: "Liz",
  });
  expect((await resolveClarityConversation(fakeDb({ member: LIZ, conversation: accepted }), "acct", CONVO, pair))?.sender).toBe("Liz");
});

it("refuses everyone and everything outside the accepted Rob–Liz DM", async () => {
  const pair = clarityPair(PAIR);
  const cases: Array<[string | null, Record<string, string> | null, unknown]> = [
    [OTHER, accepted, CONVO], // not one of the pair
    [ROB, { ...accepted, status: "pending" }, CONVO],
    [ROB, { ...accepted, recipient_id: OTHER }, CONVO], // Rob's DM with someone else
    [ROB, null, CONVO],
    [null, accepted, CONVO],
    [ROB, accepted, "not-a-uuid"],
  ];
  for (const [member, conversation, id] of cases)
    expect(await resolveClarityConversation(fakeDb({ member, conversation }), "acct", id, pair)).toBeNull();
  expect(await resolveClarityConversation(fakeDb({ member: ROB, conversation: accepted }), "acct", CONVO, null)).toBeNull();
});

const request: ClarityRequest = { sender: "Liz", recipient: "Rob", originalMessage: "Could you maybe review the $1,800 email by 5 PM?", variant: 0 };
const good: ClarityResult = {
  intent: "Rob needs to review the email by 5 PM.",
  suggestedMessage: "Review the $1,800 email by 5 PM.",
  whyChanged: "Removed permission-seeking (section 8).",
  ambiguityDetected: false,
  ambiguityNote: null,
};

it("passes the server-derived direction and the full standards to the model, and returns its review", async () => {
  const provider = vi.fn(async () => good);
  expect(await transformDraft(request, provider)).toEqual(good);
  expect(provider).toHaveBeenCalledWith(request, claritySystemPrompt(clarityStandards().text));
});

it("never invents a rewrite for an ambiguous draft", async () => {
  const result = await transformDraft(request, async () => ({ ...good, ambiguityDetected: true, ambiguityNote: "Which email?" }));
  expect(result.suggestedMessage).toBe(request.originalMessage);
  expect(result.ambiguityNote).toBe("Which email?");
  await expect(transformDraft(request, async () => ({ ...good, ambiguityDetected: true, ambiguityNote: " " }))).rejects.toThrow(/incomplete/);
});

it("restores the original when a number changes", async () => {
  const result = await transformDraft(request, async () => ({ ...good, suggestedMessage: "Review the $1,900 email by 5 PM." }));
  expect(result.suggestedMessage).toBe(request.originalMessage);
  expect(result.ambiguityDetected).toBe(true);
  // Formatting differences in the same number are fine.
  expect(preserveNumbers("pay 1800", { ...good, suggestedMessage: "Pay 1,800." }).suggestedMessage).toBe("Pay 1,800.");
});

it("rejects malformed model output and invalid drafts without returning anything sendable", async () => {
  await expect(transformDraft(request, async () => ({ intent: "x" }))).rejects.toThrow(/incomplete/);
  await expect(transformDraft(request, async () => ({ ...good, extra: true, suggestedMessage: "" }))).rejects.toThrow(/incomplete/);
  await expect(transformDraft({ ...request, originalMessage: "   " }, async () => good)).rejects.toThrow("invalid_draft");
  await expect(transformDraft({ ...request, originalMessage: "x".repeat(2001) }, async () => good)).rejects.toThrow("invalid_draft");
});

it("accepts only well-formed review metadata", () => {
  const payload = { original: "raw", suggested: "clear", intent: "i", whyChanged: "w", ambiguityNote: null, usedSuggestion: true };
  expect(parseClarityPayload(payload)).toEqual({ ...payload });
  for (const bad of [null, [], { ...payload, original: "" }, { ...payload, usedSuggestion: "yes" }, { ...payload, intent: 5 }, { ...payload, original: "x".repeat(2001) }])
    expect(parseClarityPayload(bad)).toBeNull();
});

it("stores the private record only for the sender's own message, using the server's final text", async () => {
  vi.stubEnv("CHAT_CLARITY_PAIR", PAIR);
  const clarity = { original: "raw draft", suggested: "clear", intent: "i", whyChanged: "w", ambiguityNote: null, usedSuggestion: true };
  const db = fakeDb({ member: ROB, conversation: accepted });
  expect(await saveClarityDraft(db, "acct", CONVO, { id: "m1", sender_id: ROB, body: "server final" }, { ...clarity, final: "spoofed" })).toBe(true);
  expect(db.upserts[0]).toMatchObject({ message_id: "m1", sender_member_id: ROB, original_body: "raw draft", final_body: "server final", standards_sha256: clarityStandards().sha256 });
  // Someone else's message, a non-pair DM, or bad metadata store nothing.
  const other = fakeDb({ member: ROB, conversation: accepted });
  expect(await saveClarityDraft(other, "acct", CONVO, { id: "m2", sender_id: LIZ, body: "x" }, clarity)).toBe(false);
  const outsider = fakeDb({ member: OTHER, conversation: accepted });
  expect(await saveClarityDraft(outsider, "acct", CONVO, { id: "m3", sender_id: OTHER, body: "x" }, clarity)).toBe(false);
  expect(await saveClarityDraft(db, "acct", CONVO, { id: "m4", sender_id: ROB, body: "x" }, { original: "" })).toBe(false);
  expect(other.upserts.length + outsider.upserts.length).toBe(0);
  vi.unstubAllEnvs();
});

beforeEach(() => vi.unstubAllEnvs());
