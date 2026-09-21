import type { Metadata } from "next";
import { IBM_Plex_Sans, Space_Grotesk } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const headingFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-heading",
});

const bodyFont = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "AI-E | Bounded plans for game-dev requests",
  description:
    "Public AI-E spine: chat plus a real planner tool that turns messy game-dev intent into a review-gated plan. Demo mode works without private keys.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${headingFont.variable} ${bodyFont.variable} min-h-screen bg-mesh text-ink antialiased`}>
        {children}
      </body>
    </html>
  );
}