import { Barlow_Condensed, DM_Sans } from "next/font/google";

const heading = Barlow_Condensed({ subsets: ["latin"], weight: ["700", "800"], variable: "--chat-login-heading", display: "swap" });
const body = DM_Sans({ subsets: ["latin"], variable: "--chat-login-body", display: "swap" });
export const chatLoginFonts = `${heading.variable} ${body.variable}`;
