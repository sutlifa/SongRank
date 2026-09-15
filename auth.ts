import NextAuth, { type Session } from "next-auth";
import Google from "next-auth/providers/google";
import { upsertUser } from "./lib/users";

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [
        Google({
            // Without this, Google silently re-authenticates anyone whose browser
            // still has an active Google session and who's already approved this
            // app once -- no prompt, no account picker, it just signs them back
            // in instantly. That's expected Google SSO behavior, but it makes our
            // own sign-out feel broken ("I signed out and it just logged me back
            // in"). Forcing the account picker every time makes re-auth a
            // deliberate action instead of an invisible one.
            authorization: { params: { prompt: "select_account" } },
        }),
    ],
    session: { strategy: "jwt" },
    callbacks: {
        async jwt({ token, profile }) {
            // Only runs on actual sign-in (when `profile` is present), not on
            // every token refresh -- upsertUser only needs to run once per login.
            if (profile?.sub && profile.email) {
                const userId = await upsertUser({
                    googleId: profile.sub,
                    email: profile.email,
                    name: profile.name ?? null,
                    image: typeof profile.picture === "string" ? profile.picture : null,
                });
                token.userId = userId;
            }
            return token;
        },
        // Auth.js v5 types this callback's params as a union covering both the
        // database-adapter and JWT session strategies; since this app only ever
        // uses the JWT strategy (session.strategy above), the mismatch against
        // the adapter-session branch is a known typing rough edge, not a real
        // type error -- hence the unknown-first cast TypeScript itself suggests.
        async session({ session, token }): Promise<Session> {
            return {
                ...session,
                user: { ...session.user, id: token.userId },
            } as unknown as Session;
        },
    },
    pages: {
        signIn: "/signin",
    },
});
