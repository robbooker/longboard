import type { Metadata, Viewport } from "next";
export const metadata: Metadata = {
  manifest: "/chat/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Rob Booker Chat", statusBarStyle: "default" },
  // Next 15 emits only the standard mobile-web-app-capable tag; keep the Apple one for older iOS.
  other: { "apple-mobile-web-app-capable": "yes" },
  icons: { apple: { url: "/chat-rb-apple-touch-icon-v1-180.png", sizes: "180x180", type: "image/png" } },
};
// Matches the manifest theme_color (chat header surface in the default dark palette).
export const viewport: Viewport = { themeColor: "#0d1914" };
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return children;
}
