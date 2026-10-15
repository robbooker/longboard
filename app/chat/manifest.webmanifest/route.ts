import { NextResponse } from "next/server";

// Colors follow the chat's default dark palette (components/chat/PublicChat.module.css):
// background_color = --chat-bg so the launch splash matches the first paint,
// theme_color = the header surface so the system bar blends into the chat header.
export function GET() {
  return NextResponse.json(
    {
      id: "/chat",
      name: "Rob Booker Chat",
      short_name: "RB Chat",
      description: "Rob Booker member chat",
      lang: "en",
      dir: "ltr",
      start_url: "/chat",
      scope: "/chat",
      display: "standalone",
      orientation: "any",
      background_color: "#07110d",
      theme_color: "#0d1914",
      icons: [
        { src: "/chat-rb-icon-v1-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/chat-rb-icon-v1-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/chat-rb-icon-v1-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/chat-rb-icon-v1-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      ],
    },
    {
      headers: {
        "Content-Type": "application/manifest+json",
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    },
  );
}
