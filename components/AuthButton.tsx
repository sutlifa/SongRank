"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";

/**
 * The signed-in/signed-out control in the header.
 *
 * Only ever rendered from inside `{authEnabled && <AuthButton />}` -- see
 * components/Providers.tsx -- so it's safe to call `useSession()`
 * unconditionally here even though the whole feature is conditional at the
 * app level.
 */
export default function AuthButton() {
    const { data: session, status } = useSession();

    if (status === "loading") {
        return <span className="h-8 w-20 shrink-0" aria-hidden="true" />;
    }

    if (!session?.user) {
        return (
            <Link href="/signin" className="btn-secondary">
                Sign in
            </Link>
        );
    }

    return (
        <div className="flex items-center gap-2">
            <Link
                href="/history"
                className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-fg-muted hover:bg-bg-soft-2 hover:text-fg"
                title={session.user.email ?? undefined}
            >
                {session.user.image ? (
                    // Plain <img>, not next/image: the avatar comes straight from
                    // whatever CDN Google happens to serve it from, which isn't
                    // worth an images.remotePatterns entry for one small icon.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={session.user.image} alt="" width={24} height={24} className="rounded-full" />
                ) : null}
                <span className="max-w-28 truncate">{session.user.name ?? "History"}</span>
            </Link>
            <button type="button" onClick={() => signOut({ redirectTo: "/" })} className="btn-ghost !px-2 !py-1 text-xs">
                Sign out
            </button>
        </div>
    );
}
