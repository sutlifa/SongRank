import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    images: {
        // Album art comes from Apple's iTunes/Music CDN (the preview API returns
        // `artworkUrl100` pointing at mzstatic.com). Listing the host here is what
        // lets next/image optimise it instead of refusing to load it.
        remotePatterns: [
            { protocol: "https", hostname: "*.mzstatic.com" },
            { protocol: "https", hostname: "i.scdn.co" },
        ],
    },
};

export default nextConfig;
