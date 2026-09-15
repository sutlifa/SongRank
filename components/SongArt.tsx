/**
 * Album art, or a deterministic initials placeholder when there isn't any.
 *
 * "No artwork" is a normal outcome (fixtures never have any, and plenty of
 * real iTunes results are missing it too), not an error state -- so the
 * fallback is designed to look intentional rather than broken. The
 * background hue is derived from the title so the same song always gets the
 * same placeholder color across renders, without needing to store one.
 *
 * Plain <img>, not next/image: artwork only ever comes from iTunes's
 * mzstatic.com CDN -- optimizing one external, already-compressed JPEG isn't
 * worth maintaining an images.remotePatterns allowlist for.
 */
export default function SongArt({
    title,
    artworkUrl,
    size = 64,
    className = "",
}: {
    title: string;
    artworkUrl: string | null;
    size?: number;
    className?: string;
}) {
    if (artworkUrl) {
        return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={artworkUrl}
                alt=""
                width={size}
                height={size}
                className={`shrink-0 rounded-lg object-cover ${className}`}
                style={{ width: size, height: size }}
            />
        );
    }

    const hue = hashHue(title);
    const initials = title
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase())
        .join("");

    return (
        <div
            className={`flex shrink-0 items-center justify-center rounded-lg font-bold text-white/90 ${className}`}
            style={{
                width: size,
                height: size,
                background: `linear-gradient(135deg, hsl(${hue} 55% 32%), hsl(${(hue + 40) % 360} 55% 22%))`,
                fontSize: Math.max(11, size * 0.32),
            }}
            aria-hidden="true"
        >
            {initials || "♪"}
        </div>
    );
}

function hashHue(s: string): number {
    let hash = 0;
    for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
    return hash % 360;
}
