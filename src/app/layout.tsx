import type { Metadata, Viewport } from "next";
import { Poppins, Righteous } from "next/font/google";
import { TRPCReactProvider } from "~/trpc/react";
import "./globals.css";

/**
 * Righteous for display, Poppins for body — the pairing from the Mentor
 * Playbook deck.
 *
 * Loaded through `next/font` rather than a `<link>` to fonts.googleapis.com.
 * That is not a style preference: the CSP in `next.config.ts` is
 * `default-src 'self'` with `font-src 'self' data:`, so a CDN stylesheet and
 * its font files would both be blocked. `next/font` downloads at build time and
 * serves from our own origin, which keeps the policy intact instead of forcing
 * two more allowlisted hosts into it. It also self-hosts the `@font-face` rules,
 * so there is no render-blocking round trip to a third party.
 */

const display = Righteous({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const body = Poppins({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nutrition",
  description: "Personal macro planning, meal scheduling and grocery lists.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh">
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
