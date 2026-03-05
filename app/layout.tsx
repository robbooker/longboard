import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Longboard",
  description: "AI-powered stock research by Buddy",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="scanline" />
        {children}
      </body>
    </html>
  );
}
