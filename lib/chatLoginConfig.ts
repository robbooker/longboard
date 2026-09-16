export const CHAT_SESSION_COOKIE = "lb-chat-session";
export const CHAT_LOGIN_COOKIE = "lb-chat-login";
export const SHORTSCOUT_SITE = "https://shortscout.ai";
export const CHAT_SITE = "https://www.longboardai.com";
export const chatCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV !== "development",
  sameSite: "lax" as const,
  path: "/",
};
