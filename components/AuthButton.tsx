"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
    const pathname = usePathname();

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
            {/* The label sits to the LEFT of the avatar, and says where the
                link goes rather than who you are.

                It used to read your own name next to your own picture, which
                is two ways of saying the same thing and neither of them says
                "your rankings are in here" -- so the one destination that is
                actually about you was the only one in the header with no
                label. Your name moves to the tooltip, alongside the email
                that was already there. */}
            <Link
                href="/my-rankings"
                // Carries the same selected state as the nav links beside it
                // (see SiteHeader): it IS one of them, just one that happens
                // to wear your face.
                className={`flex items-center gap-2 rounded-lg px-2 py-1 text-sm font-medium ${
                    pathname === "/my-rankings"
                        ? "bg-bg-soft-2 text-fg"
                        : "text-fg-muted hover:bg-bg-soft-2 hover:text-fg"
                }`}
                title={[session.user.name, session.user.email].filter(Boolean).join(" · ") || undefined}
            >
                <span className="whitespace-nowrap">My Rankings</span>
                {session.user.image ? (
                    // Plain <img>, not next/image: the avatar comes straight from
                    // whatever CDN Google happens to serve it from, which isn't
                    // worth an images.remotePatterns entry for one small icon.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={session.user.image} alt="" width={24} height={24} className="rounded-full" />
                ) : null}
            </Link>
            <button type="button" onClick={() => signOut({ redirectTo: "/" })} className="btn-ghost !px-2 !py-1 text-xs">
                Sign out
            </button>
        </div>
    );
}
