import { redirect } from "next/navigation";
import { Nav } from "~/components/nav";
import { getSettings } from "~/server/db/state";

/**
 * The signed-in shell.
 *
 * `/setup` sits outside this route group precisely so this gate cannot redirect
 * to itself. Every page inside it can assume setup is done and a profile
 * exists.
 */

/**
 * Never prerendered. This layout reads the database to decide whether setup is
 * complete, which is runtime state — and a build that needs a populated
 * database is a build that fails on a fresh checkout, in CI, and in any
 * container that builds before the volume is mounted.
 */
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  if (!getSettings().setupComplete) redirect("/setup");

  return (
    <>
      <Nav />
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </>
  );
}
