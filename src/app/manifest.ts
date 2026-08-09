import type { MetadataRoute } from "next";

/**
 * Web app manifest, so the app can be installed to a phone's home screen.
 *
 * This is the one place the deployment story and the product actually meet: the
 * app is used standing in a kitchen or walking round a shop, and a browser tab
 * is the wrong container for that. Installed, it opens full-screen with no URL
 * bar eating the top of a short list.
 *
 * `display: "standalone"` rather than `"fullscreen"` deliberately — the status
 * bar clock is worth keeping when you are timing something on a hob.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Recipe Generator",
    short_name: "Recipe Generator",
    description: "Personal macro planning, meal scheduling and grocery lists.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    // Mirrors `--color-canvas` / `--color-accent` in the light scheme. See the
    // note on `themeColor` in `layout.tsx` about why these are literals.
    background_color: "#fdfaf7",
    theme_color: "#fdfaf7",
    // One SVG at "any" rather than a PNG ladder: Chrome has accepted scalable
    // manifest icons for years, and iOS ignores this list entirely — it reads
    // the `apple-touch-icon` link that `apple-icon.tsx` generates.
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
