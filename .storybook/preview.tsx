import type { Preview } from "@storybook/nextjs";
import { Poppins, Righteous } from "next/font/google";
import "../src/app/globals.css";

/**
 * The app's own stylesheet and fonts, so a story looks like the app.
 *
 * The fonts matter more than they look. `globals.css` maps `--font-sans` and
 * `--font-display` onto variables that `next/font` defines in the root layout —
 * which Storybook never renders. Without loading them here every story falls
 * back to a system face, and the display type is half the visual identity, so
 * the components would look subtly wrong in exactly the tool meant to judge how
 * they look.
 *
 * Loaded through `next/font` rather than a stylesheet link so it is the same
 * mechanism the app uses, and so it stays self-hosted.
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

const preview: Preview = {
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
    // The palette is deliberately theme-aware, so the default white canvas
    // would misrepresent every component. These match `--color-canvas`.
    backgrounds: {
      options: {
        light: { name: "light", value: "#fdfaf7" },
        dark: { name: "dark", value: "#191512" },
      },
    },
    a11y: { test: "todo" },
  },

  initialGlobals: { backgrounds: { value: "light" } },

  decorators: [
    (Story) => (
      <div className={`${display.variable} ${body.variable} font-sans text-ink`}>
        <Story />
      </div>
    ),
  ],
};

export default preview;
