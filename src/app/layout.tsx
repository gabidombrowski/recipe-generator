import type { Metadata, Viewport } from "next";
import { Poppins, Righteous } from "next/font/google";
import { TRPCReactProvider } from "~/trpc/react";
import "./globals.css";

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
  title: "Recipe Generator",
  description: "Personal macro planning, meal scheduling and grocery lists.",
  robots: { index: false, follow: false },
  // Installed to a home screen this is a standalone app, not a bookmark, so it
  // gets a short name and the iOS status bar treatment to match.
  appleWebApp: {
    capable: true,
    title: "Recipe Generator",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /**
   * Matches `--color-canvas` in each scheme, so the browser chrome and the
   * status bar continue the page rather than framing it in white. Hardcoded
   * hex because this header is read before any stylesheet: it cannot reference
   * the custom properties it is mirroring, which means the two can drift.
   * `globals.css` is the source of truth if they disagree.
   */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#191512" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh">
        <TRPCReactProvider>{children}</TRPCReactProvider>
      </body>
    </html>
  );
}
