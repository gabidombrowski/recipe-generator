import { ImageResponse } from "next/og";

/**
 * The iOS home-screen icon.
 *
 * Generated rather than committed as a PNG because Next only accepts raster
 * formats here — `icon.svg` covers every other surface, and a binary duplicate
 * of it in the repo would be one more thing to keep in sync by hand.
 *
 * Shapes only, no text: `ImageResponse` would otherwise need a font loaded and
 * embedded, and this mark does not use one. iOS applies its own rounding and
 * refuses transparency, so the background is drawn edge to edge.
 */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Matches `--color-accent` in the light scheme; see `icon.svg`.
          background: "#136156",
        }}
      >
        <div
          style={{
            width: 108,
            height: 108,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            border: "11px solid #fdfaf7",
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              background: "#fdfaf7",
            }}
          />
        </div>
      </div>
    ),
    size,
  );
}
