import type { Metadata } from "next";
import { Poppins, Righteous } from "next/font/google";
import { Announcer } from "~/components/atoms";
import { Nav } from "~/components/organisms/nav";
import "./demo.css";
import { DemoProviders } from "./providers";

/**
 * The demo's root layout: the production fonts, stylesheet, nav and announcer
 * around the production pages — minus everything that needs a server. No
 * auth gate (there is nothing to protect), no database read (there is no
 * database), and a banner that keeps the one promise a demo must keep: being
 * unmistakably a demo.
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
  title: "Nutrition — demo",
  description:
    "Interactive demo of a personal meal planner. Recorded data, nothing saves.",
  // A demo should be findable from the portfolio that embeds it, not from a
  // search engine that strips that context.
  robots: { index: false, follow: false },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh">
        <DemoProviders>
          <div
            role="note"
            className="border-b border-accent/30 bg-accent-soft px-4 py-2 text-center text-sm text-accent"
          >
            Interactive demo — recorded data, AI responses are replays, and
            nothing you do here is saved.{" "}
            <a
              className="underline"
              href="https://github.com/gabidombrowski/recipe-generator"
            >
              Source on GitHub
            </a>
          </div>
          <Nav />
          <main id="main" tabIndex={-1} className="mx-auto max-w-5xl px-4 py-6">
            {children}
          </main>
        </DemoProviders>
        <Announcer />
      </body>
    </html>
  );
}
