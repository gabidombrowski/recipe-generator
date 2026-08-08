import { signIn } from "~/server/auth";
import { Button, Card } from "~/components/ui";

/**
 * Sign-in.
 *
 * One provider, one allowlisted identity. The page says so plainly rather than
 * showing a generic failure after the fact — if you are not the one person this
 * app is for, better to know before the OAuth round trip.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  const { callbackUrl, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <Card className="w-full">
        <h1 className="text-xl font-semibold">Nutrition</h1>
        <p className="mt-2 text-sm text-ink-muted">
          A single-user app. Sign-in is restricted to one GitHub account.
        </p>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn"
          >
            That account is not permitted to sign in.
          </p>
        )}

        <form
          className="mt-6"
          action={async () => {
            "use server";
            await signIn("github", { redirectTo: callbackUrl ?? "/" });
          }}
        >
          <Button type="submit" variant="primary" className="w-full py-2">
            Continue with GitHub
          </Button>
        </form>
      </Card>
    </main>
  );
}
