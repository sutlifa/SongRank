"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

/**
 * Site-wide nudge for a signed-in account with no handle yet.
 *
 * This exists because of *when* usernames arrived. Everyone who signed in
 * before they did has an account that works perfectly but is effectively
 * unlisted -- findable only by whoever already knows their display name or
 * their email address. That is not a state anyone opted into, and it is not
 * one they can discover: nothing about the app looks broken. A prompt only on
 * /my-rankings and /people reaches the people who happen to go there, which is
 * exactly the wrong set (someone who never visits /people is the person least
 * likely to realise they are missing from it).
 *
 * ## Why a client fetch rather than a server check in the layout
 *
 * The root layout renders on every route. Calling `auth()` there reads cookies,
 * which makes every page in the app dynamic -- a real cost on the statically
 * prerenderable ones (/, /about, /privacy, /starters) paid forever, to answer a
 * question that matters once per account. So this asks over the wire instead,
 * and only for a visitor who actually has a session.
 *
 * Once the answer is "yes, you have one", it is remembered for the rest of the
 * browser tab, so this costs one small query per tab rather than one per
 * navigation. The "no" answer is deliberately not cached: that is the case the
 * banner is for, and re-asking is how it disappears the moment a handle is
 * claimed in another tab.
 */

/** Per-tab memo of "this account already has a handle". Only ever written for
 * the affirmative -- see the header. */
const HAS_USERNAME_KEY = "songrank:has-username";
/** Per-tab dismissal, so the banner can be waved away without being a nag on
 * every single navigation. It comes back in a new tab, which is the right
 * balance for something that only stops when the account is actually set up. */
const DISMISSED_KEY = "songrank:username-banner-dismissed";

/** sessionStorage throws in a private window, with site data blocked, and in
 * some embedded webviews. Every access is wrapped because failing to read a
 * cache must degrade to "ask again", never to a blank page. */
function readFlag(key: string): boolean {
    try {
        return sessionStorage.getItem(key) === "1";
    } catch {
        return false;
    }
}

function writeFlag(key: string): void {
    try {
        sessionStorage.setItem(key, "1");
    } catch {
        // No cache available. The only consequence is one extra small request
        // per navigation, which is not worth reporting to anyone.
    }
}

export default function UsernameBanner() {
    const { data: session, status } = useSession();
    const [needsUsername, setNeedsUsername] = useState(false);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        if (status !== "authenticated" || !session?.user) return;
        if (readFlag(HAS_USERNAME_KEY) || readFlag(DISMISSED_KEY)) return;

        let cancelled = false;
        // State is set only inside this async callback, never synchronously in
        // the effect body -- the same cascading-render rule PeopleSearch
        // follows, and the same reason: reacting to a fetch is not the same
        // thing as deriving view output during render.
        (async () => {
            try {
                const res = await fetch("/api/account/username");
                if (!res.ok || cancelled) return;
                const body = (await res.json()) as { username?: string | null };
                if (cancelled) return;
                if (body.username) writeFlag(HAS_USERNAME_KEY);
                else setNeedsUsername(true);
            } catch {
                // Offline, or the route is unavailable. Say nothing: a banner
                // that appears because a request failed would tell people to
                // fix something that may not be wrong.
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [status, session]);

    if (!needsUsername || dismissed) return null;

    return (
        <div className="border-b border-accent/30 bg-accent/10">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:px-6">
                <p className="min-w-0 flex-1 text-fg-muted">
                    <span className="font-semibold text-accent">Pick a username</span> so friends can
                    find you — without either of you sharing an email address.
                </p>
                <Link href="/my-rankings" className="btn-secondary shrink-0 !px-3 !py-1 text-xs">
                    Choose one
                </Link>
                <button
                    type="button"
                    onClick={() => {
                        setDismissed(true);
                        writeFlag(DISMISSED_KEY);
                    }}
                    className="btn-ghost shrink-0 !px-2 !py-1 text-xs"
                    aria-label="Dismiss username reminder"
                >
                    ✕
                </button>
            </div>
        </div>
    );
}
