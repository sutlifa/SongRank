import { NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { deleteUser } from "@/lib/users";

/**
 * DELETE /api/account
 *
 * Deletes the signed-in user's account and every ranking they saved. There is
 * no confirmation parameter here on purpose: confirming is the UI's job (see
 * components/DeleteAccountControl), and a server-side "are you sure" flag is
 * security theatre -- anything that can call this endpoint can set the flag.
 * What actually protects the account is the session guard.
 *
 * The caller is expected to sign out immediately afterwards. This route cannot
 * do that for them: sessions are JWTs (see auth.ts), so the cookie in the
 * browser stays valid until it is cleared client-side, and it would otherwise
 * keep presenting a user id that no longer exists.
 */
export async function DELETE() {
    const g = await requireUser();
    if (isGuardFailure(g)) return g.response;

    try {
        const deleted = await deleteUser(g.userId);
        if (!deleted) {
            // The session pointed at a user row that is already gone -- a
            // double-submit, or an account deleted in another tab. Treat it as
            // success: the caller's goal ("this account should not exist") is
            // satisfied, and reporting a failure would only invite a retry that
            // cannot do anything.
            return NextResponse.json({ ok: true, alreadyGone: true });
        }
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error("DELETE ACCOUNT ERROR:", err);
        return NextResponse.json(
            { error: "Could not delete your account. Nothing was removed — please try again." },
            { status: 500 }
        );
    }
}
