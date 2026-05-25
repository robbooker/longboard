import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import OneSignalProvider from "@/components/OneSignalProvider";
import PedroChat from "@/components/pedro/PedroChat";
import "./globals.css";

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  // metadataBase is the origin Next uses to resolve relative OG image
  // URLs (including the auto-generated opengraph-image.tsx routes).
  // Falls back to the Vercel prod URL; override locally via env if
  // you want previews to unfurl to a branch URL instead.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://longboardai.com"),
  title: "Longboard",
  description: "AI-powered stock research terminal",
};

// Path-aware no-preference default: /boardroom defaults to "statement"
// (boardroom is a single branded surface — first visit should match the
// statement-theme aesthetic). All other paths default to "light".
// Critically: this never WRITES to localStorage. If the user explicitly
// picks any theme via UserMenu, that becomes their persisted preference
// for every page. If they never pick, /boardroom shows statement and
// other pages show light, with no spillover.
const themeInitScript = `
(function(){
  try{
    var t=localStorage.getItem("longboard-theme");
    if(t!=="dark"&&t!=="light"&&t!=="statement"){
      t=window.location.pathname.indexOf("/boardroom")===0?"statement":"light";
    }
    document.documentElement.setAttribute("data-theme",t);
  }catch(e){
    document.documentElement.setAttribute("data-theme","light");
  }
  try{
    var u=localStorage.getItem("longboard-ui");
    if(u!=="classic"&&u!=="modern"){u="modern";}
    document.documentElement.setAttribute("data-ui",u);
  }catch(e2){
    document.documentElement.setAttribute("data-ui","modern");
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-theme="light" data-ui="modern" className={ibmPlexMono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <div className="scanline" />
        <OneSignalProvider />
        {children}
        <PedroChat />
        {process.env.NODE_ENV === "production" && (
          <GoogleAnalytics gaId="G-3013VH6PVF" />
        )}
      </body>
    </html>
  );
}
