"use client";

import { SessionProvider } from "next-auth/react";

/**
 * Session context for client components.
 *
 * `SessionProvider` fetches /api/auth/session as soon as it mounts. On a
 * deployment with no AUTH_SECRET/Google credentials configured, that request
 * can fail, so every visitor would otherwise eat a failing fetch and a
 * console error on every single page load -- even on a page with no sign-in
 * UI at all. Since there's no session to provide on such a deployment
 * anyway, the provider is skipped entirely rather than mounted and left to
 * fail quietly.
 *
 * Every component that reads the session (AuthButton, the tournament
 * player's server-sync, /my-rankings) is only ever *rendered* when `authEnabled`
 * is true -- never conditionally calls the `useSession` hook itself -- so
 * they can assume this provider is present whenever they run. See
 * app/layout.tsx and components/AuthButton.tsx for the pattern.
 */
export default function Providers({
    children,
    authEnabled,
}: {
    children: React.ReactNode;
    authEnabled: boolean;
}) {
    if (!authEnabled) return <>{children}</>;
    return <SessionProvider>{children}</SessionProvider>;
}
