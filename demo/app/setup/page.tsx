import Link from "next/link";

/** Settings' "re-run setup" lands here; the wizard itself needs a server. */
export default function SetupStub() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <p className="text-sm text-ink-muted">
        The setup wizard writes to a database, so it sits outside this demo.
      </p>
      <Link className="mt-4 inline-block underline" href="/">
        Back to the demo
      </Link>
    </main>
  );
}
