import { describe, it, expect } from "vitest";
import { newChatLoginSecret, validChatLoginSecret, chatSecretHash, chatLoginChallenge, verifyChatLoginProof } from "@/lib/chatLoginProof";
describe("chat login browser proof", () => {
  it("accepts only the original browser verifier", () => {
    const verifier = newChatLoginSecret();
    const challenge = chatLoginChallenge(verifier);
    expect(validChatLoginSecret(verifier)).toBe(true);
    expect(verifyChatLoginProof(verifier, challenge)).toBe(true);
    expect(verifyChatLoginProof(newChatLoginSecret(), challenge)).toBe(false);
    expect(verifyChatLoginProof(challenge, challenge)).toBe(false);
    expect(chatSecretHash(verifier)).toMatch(/^[0-9a-f]{64}$/);
  });
  it.each([null, undefined, "", "a".repeat(44), "?".repeat(43)])("rejects malformed proof %j", value => {
    expect(verifyChatLoginProof(value, chatLoginChallenge(newChatLoginSecret()))).toBe(false);
    expect(verifyChatLoginProof(newChatLoginSecret(), value)).toBe(false);
  });
});
