import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import Providers from "@/components/Providers";
import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import { isAuthConfigured } from "@/lib/authConfig";

export const metadata = {
    title: {
        default: "SongRank",
        template: "%s — SongRank",
    },
    description: "Rank any list of songs with a head-to-head Swiss tournament, then export the result.",
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
                    <main className="flex-1">{children}</main>
                    <SiteFooter />
                </Providers>
                <Analytics />
            </body>
        </html>
    );
}
