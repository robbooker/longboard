import { createHash, randomBytes } from "node:crypto";

export type InviteLink = {
  token: string;
  tokenHash: string;
  url: string;
};

export function inviteBaseUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "https://longboardai.com";
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createInviteLink(): InviteLink {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashInviteToken(token),
    url: `${inviteBaseUrl()}/invite/${token}`,
  };
}

export function inviteUrlForToken(token: string) {
  return `${inviteBaseUrl()}/invite/${token}`;
}
