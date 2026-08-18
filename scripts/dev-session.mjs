#!/usr/bin/env node
import { mintSession } from "./session.mjs";

/**
 * Prints a local development session cookie for hand-pasting. The minting
 * itself (and the honest reasoning about why it is not a bypass) lives in
 * `session.mjs`; `dev-signed-in.mjs` is the no-paste version of this.
 *
 *   npm run dev:session
 */

const { accountId, authUrl, cookieName, token } = await mintSession();

console.log(`\nSigned in as GitHub id ${accountId} for 7 days.\n`);
console.log("Paste this into the DevTools console on the sign-in page, then reload:\n");
console.log(`  document.cookie = ${JSON.stringify(`${cookieName}=${token}; path=/; max-age=604800`)}\n`);
console.log("Or with curl:\n");
console.log(`  curl -s ${authUrl}/ -H 'Cookie: ${cookieName}=${token}' | head -20\n`);
