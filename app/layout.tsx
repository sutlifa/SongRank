import "./globals.css";
import { Analytics } from "@vercel/analytics/next";
import Providers from "@/components/Providers";
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
            <body className="min-h-screen bg-bg text-fg">
                <Providers authEnabled={authEnabled}>
                    <SiteHeader authEnabled={authEnabled} />
                    <main>{children}</main>
                </Providers>
                <Analytics />
            </body>
        </html>
    );
}
