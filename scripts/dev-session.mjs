#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { encode } from "next-auth/jwt";

/**
 * Mints a local development session cookie.
 *
 * Setting up a GitHub OAuth app is the right thing to do, but it is a detour
 * when you just want to look at the app. This signs a real Auth.js JWT with the
 * project's own `AUTH_SECRET`, so the middleware validates it exactly as it
 * would a genuine sign-in — no bypass, no `SKIP_AUTH` flag, nothing that could
 * accidentally ship. It is the same mechanism the Playwright suite uses.
 *
 * It only works if you already hold `AUTH_SECRET`, which means it grants
 * nothing you could not already grant yourself.
 *
 *   node scripts/dev-session.mjs
 */

function readEnv() {
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

const env = readEnv();
const secret = env.AUTH_SECRET;

if (!secret) {
  console.error("AUTH_SECRET is not set. Add it to .env first:\n");
  console.error("  echo \"AUTH_SECRET=$(openssl rand -base64 32)\" >> .env\n");
  process.exit(1);
}

const accountId = env.ALLOWED_GITHUB_ID?.split(",")[0]?.trim();
if (!accountId) {
  console.error("ALLOWED_GITHUB_ID is not set in .env — the allowlist would reject every identity.");
  process.exit(1);
}

const authUrl = env.AUTH_URL ?? "http://localhost:3000";
const secure = authUrl.startsWith("https://");
const cookieName = secure ? "__Secure-authjs.session-token" : "authjs.session-token";

const token = await encode({
  // `sub` is the identity the session is keyed on; see `auth.ts`.
  token: { name: "Local dev", sub: accountId },
  secret,
  salt: cookieName,
  maxAge: 60 * 60 * 24 * 7,
});

console.log(`\nSigned in as ${email} for 7 days.\n`);
console.log("Paste this into the DevTools console on the sign-in page, then reload:\n");
console.log(`  document.cookie = ${JSON.stringify(`${cookieName}=${token}; path=/; max-age=604800`)}\n`);
console.log("Or with curl:\n");
console.log(`  curl -s ${authUrl}/ -H 'Cookie: ${cookieName}=${token}' | head -20\n`);
