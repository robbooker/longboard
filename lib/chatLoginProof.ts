import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function newChatLoginSecret() {
  return randomBytes(32).toString("base64url");
}
export function validChatLoginSecret(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
export function chatSecretHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function chatLoginChallenge(verifier: string) {
  return createHash("sha256").update(verifier).digest("base64url");
}
export function verifyChatLoginProof(verifier: unknown, challenge: unknown) {
  if (!validChatLoginSecret(verifier) || !validChatLoginSecret(challenge)) return false;
  return timingSafeEqual(Buffer.from(chatLoginChallenge(verifier)), Buffer.from(challenge));
}
