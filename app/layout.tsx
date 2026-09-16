import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import Providers from "@/components/Providers";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import UsernameBanner from "@/components/UsernameBanner";
import { isAuthConfigured } from "@/lib/authConfig";

/**
 * The colour mobile browsers paint their own chrome with, matching the logo
 * tile. Lives in `viewport` rather than `metadata` -- Next moved themeColor
 * there, and setting it on `metadata` is silently ignored.
 *
 * Two entries so the bar tracks the page rather than fighting it: the app
 * already re-themes itself on `prefers-color-scheme` (see app/globals.css), and
 * a bright accent bar above a dark page reads as a rendering bug.
 */
export const viewport = {
    themeColor: [
        { media: "(prefers-color-scheme: light)", color: "#f7f7fa" },
        { media: "(prefers-color-scheme: dark)", color: "#08080c" },
    ],
};

export const metadata = {
    title: {
        default: "SongRank",
        template: "%s — SongRank",
    },
    description: "Rank any list of songs with an adaptive head-to-head comparison engine, then export the result.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
    const authEnabled = isAuthConfigured();

    return (
        <html lang="en">
            {/* Flex column with a growing <main> so the footer sits at the
                bottom of the viewport on short pages (/signin, an empty
                /history) instead of floating halfway up with blank space
                under it. `min-h-screen` alone only guarantees the body is
                tall enough -- it says nothing about where the last child
                lands inside it. */}
            <body className="flex min-h-screen flex-col bg-bg text-fg">
                <Providers authEnabled={authEnabled}>
                    <SiteHeader authEnabled={authEnabled} />
                    {/* Only where there are accounts to have handles. Inside
                        Providers because it calls useSession(); see
                        components/Providers.tsx for why that gating exists. */}
                    {authEnabled && <UsernameBanner />}
                    <main className="flex-1">{children}</main>
                    <SiteFooter />
                </Providers>
                <Analytics />
            </body>
        </html>
    );
}
