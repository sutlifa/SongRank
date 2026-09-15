"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

/**
 * Bridges next-auth's session status to a parent that isn't itself gated by
 * `authEnabled` and so can't call `useSession()` directly -- see
 * AuthButton's and TournamentServerSync's header comments for why calling it
 * unconditionally would be unsafe (no `SessionProvider` exists on a
 * deployment with auth off, see components/Providers.tsx). This component
 * follows the same rule from the other direction: it is only ever rendered
 * from inside `{authEnabled && <SessionStatus ... />}`, never unconditionally.
 *
 * Renders nothing; exists purely to run the effect below and report back.
 */
export default function SessionStatus({
    onChange,
}: {
    onChange: (signedIn: boolean, loading: boolean) => void;
}) {
    const { status } = useSession();

    useEffect(() => {
        onChange(status === "authenticated", status === "loading");
        // `onChange` is expected to be a stable setState wrapper from the
        // caller (see NewTournament's usage); re-running this on every
        // render would be harmless but pointless, so only `status` drives it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status]);

    return null;
}
