import type { Metadata } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import DashboardNav from "@/components/DashboardNav";

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

const themeInitScript = `
(function(){try{var t=localStorage.getItem("longboard-theme");if(t!=="dark"&&t!=="light"&&t!=="statement"){t="light";}document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","light");}})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={ibmPlexMono.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body>
        <div className="scanline" />
        <DashboardNav />
        {children}
      </body>
    </html>
  );
}
