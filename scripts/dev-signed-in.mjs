#!/usr/bin/env node
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mintSession } from "./session.mjs";

/**
 * `npm run dev:signed-in` — the dev server and a signed session, one command.
 *
 * The manual flow (`dev:session`, copy, open console, paste, reload) exists
 * because a cookie has to end up in the browser's jar for localhost:3000 and
 * a terminal cannot reach into a browser. But it doesn't need to: cookies are
 * scoped to a HOST, not a host:port pair (RFC 6265), so a one-shot helper on
 * any localhost port can Set-Cookie and redirect, and the cookie is there
 * when the app loads on port 3000. Serving it this way is also strictly
 * better than the paste — a server-set cookie can be HttpOnly, matching how
 * the real sign-in sets it, which `document.cookie` cannot.
 *
 * The helper binds 127.0.0.1 only, advertises itself as `localhost` (the
 * cookie's host must match the app's), serves exactly one browser, and closes.
 *
 *   npm run dev:signed-in            starts dev, opens the browser signed in
 *   npm run dev:signed-in --no-open  prints the sign-in URL instead
 */

const session = await mintSession(); // fail fast, before any server starts

const dev = spawn("npm", ["run", "dev"], { stdio: "inherit" });
dev.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => dev.kill("SIGINT"));

// Wait until the app answers; give up only if the dev server itself dies.
const appUrl = "http://localhost:3000";
for (;;) {
  if (dev.exitCode !== null) process.exit(dev.exitCode);
  try {
    await fetch(appUrl, { signal: AbortSignal.timeout(1000) });
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

const helper = createServer((request, response) => {
  // Anything else the browser asks for on this port (favicon, mostly) must
  // not consume the one-shot or re-set the cookie.
  if (request.url !== "/") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(302, {
    "Set-Cookie": `${session.cookieName}=${session.token}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax`,
    Location: appUrl,
  });
  response.end();
  // Close once delivered; the dev server keeps the process alive.
  helper.close();
});

helper.listen(0, "127.0.0.1", () => {
  const url = `http://localhost:${helper.address().port}/`;
  console.log(
    `\n[dev:signed-in] signed in as GitHub id ${session.accountId} for 7 days`,
  );
  if (process.argv.includes("--no-open")) {
    console.log(`[dev:signed-in] open this once to store the session: ${url}\n`);
    return;
  }
  console.log(`[dev:signed-in] opening ${url}\n`);
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
});
