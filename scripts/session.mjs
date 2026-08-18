import { readFileSync } from "node:fs";
import { encode } from "next-auth/jwt";

/**
 * The shared half of local session minting: `dev-session.mjs` prints one for
 * hand-pasting, `dev-signed-in.mjs` serves one from a helper URL. Both sign a
 * real Auth.js JWT with the project's own `AUTH_SECRET`, so the middleware
 * validates it exactly as it would a genuine sign-in — no bypass, no
 * `SKIP_AUTH` flag, nothing that could accidentally ship. Holding
 * `AUTH_SECRET` is the precondition, which means this grants nothing you
 * could not already grant yourself.
 */

export function readEnv() {
  const env = {};
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env is fine if the values are already exported.
  }
  return { ...env, ...process.env };
}

/** Exits with a readable remedy rather than throwing a stack trace. */
export async function mintSession() {
  const env = readEnv();

  const secret = env.AUTH_SECRET;
  if (!secret) {
    console.error("AUTH_SECRET is not set. Add it to .env first:\n");
    console.error('  echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env\n');
    process.exit(1);
  }

  const accountId = env.ALLOWED_GITHUB_ID?.split(",")[0]?.trim();
  if (!accountId) {
    console.error(
      "ALLOWED_GITHUB_ID is not set in .env — the allowlist would reject every identity.",
    );
    process.exit(1);
  }

  const authUrl = env.AUTH_URL ?? "http://localhost:3000";
  const cookieName = authUrl.startsWith("https://")
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";

  const token = await encode({
    // `sub` is the identity the session is keyed on; see `auth.ts`.
    token: { name: "Local dev", sub: accountId },
    secret,
    salt: cookieName,
    maxAge: 60 * 60 * 24 * 7,
  });

  return { accountId, authUrl, cookieName, token };
}
