import Link from "next/link";
import { signIn } from "@/auth";
import { isAuthConfigured } from "@/lib/authConfig";

export const metadata = { title: "Sign in" };

export default async function SignInPage({
    searchParams,
}: {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
    // Auth.js itself sends people here (`pages.signIn: "/signin"` in
    // auth.ts) whenever anything touches sign-in -- clicking "Sign in", a
    // stale session, a misconfigured deployment. A 404 in that spot reads as
    // "this app is broken" even though it's actually the app working exactly
    // as intended (no Google credentials means no sign-in to offer), and it
    // silently swallows a real deployment misconfiguration too. An honest
    // page in place of the sign-in button, saying why, is both more correct
    // and more debuggable than a 404 -- see AGENT-TEAM.md's "auth is
    // optional everywhere" rule.
    //
    // Checked before touching `searchParams`: reading that prop is what
    // opts a page into per-request dynamic rendering, and this branch has no
    // need of it (`isAuthConfigured` is a plain env read), so an
    // unconfigured deployment still gets this page prerendered as static.
    if (!isAuthConfigured()) {
        return (
            <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
                <div className="card space-y-6 p-8 text-center">
                    <div
                        className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-bg-soft-2 text-2xl"
                        aria-hidden="true"
                    >
                        ♫
                    </div>
                    <div className="space-y-2">
                        <h1 className="text-2xl font-bold">Sign-in isn&apos;t available here</h1>
                        <p className="text-sm leading-relaxed text-fg-muted">
                            This deployment doesn&apos;t have Google sign-in configured. Every tool on
                            this site works fully without an account — signing in only adds saved,
                            cross-device history on top of that.
                        </p>
                    </div>
                    <Link href="/new" className="btn-primary w-full">
                        Start a ranking
                    </Link>
                </div>
            </div>
        );
    }

    const { callbackUrl } = await searchParams;

    // A single leading slash isn't enough: "//evil.com" also starts with "/"
    // and browsers read it as a protocol-relative URL, so that check alone
    // would send someone off-site straight after signing in. Require a
    // second character that isn't a slash or backslash.
    const isSafeInternalPath =
        typeof callbackUrl === "string" &&
        callbackUrl.startsWith("/") &&
        !callbackUrl.startsWith("//") &&
        !callbackUrl.startsWith("/\\");
    const redirectTo = isSafeInternalPath ? (callbackUrl as string) : "/";

    return (
        <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
            <div className="card space-y-6 p-8 text-center">
                <div
                    className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-2xl text-accent-fg"
                    aria-hidden="true"
                >
                    ♫
                </div>

                <div className="space-y-2">
                    <h1 className="text-2xl font-bold">Sign in</h1>
                    <p className="text-sm leading-relaxed text-fg-muted">
                        Save your rankings so you can resume an unfinished one or revisit a final
                        ranking from another device. Every tool on this site works without an account —
                        signing in only adds somewhere to keep your work.
                    </p>
                </div>

                <form
                    action={async () => {
                        "use server";
                        await signIn("google", { redirectTo });
                    }}
                >
                    <button type="submit" className="btn-primary w-full">
                        Continue with Google
                    </button>
                </form>

                <p className="text-xs leading-relaxed text-fg-muted">
                    We store your Google account&apos;s name, email and avatar, plus whatever rankings
                    you choose to save.
                </p>
            </div>
        </div>
    );
}
