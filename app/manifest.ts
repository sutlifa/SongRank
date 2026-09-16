import type { MetadataRoute } from "next";

/**
 * The web app manifest: what SongRank looks like when someone installs it or
 * adds it to a home screen, and the colour the browser paints its own chrome
 * with on mobile.
 *
 * Colours are the app's accent tokens from app/globals.css. `background_color`
 * is the page background rather than the accent, because it is what fills the
 * screen during the splash before anything has rendered -- a full screen of
 * purple for that moment would be a jolt, not branding.
 */
export default function manifest(): MetadataRoute.Manifest {
    return {
        name: "SongRank",
        short_name: "SongRank",
        description:
            "Rank any list of songs with an adaptive head-to-head comparison engine, then export the result.",
        start_url: "/",
        display: "standalone",
        background_color: "#08080c",
        theme_color: "#a855f7",
        icons: [
            // The SVG first and marked "any": it is resolution independent, so
            // a launcher that understands it needs nothing else.
            { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
            { src: "/apple-icon.png", type: "image/png", sizes: "180x180" },
            { src: "/favicon.ico", type: "image/x-icon", sizes: "16x16 32x32" },
        ],
    };
}
