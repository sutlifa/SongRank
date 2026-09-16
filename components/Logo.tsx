/**
 * The SongRank mark: a rounded accent tile with a white beamed quaver.
 *
 * The note is drawn rather than set as the ♫ character, which is what it used
 * to be. A glyph is at the mercy of whatever font the platform reaches for --
 * Apple renders it as a colour emoji, some Android builds have no quaver at
 * all and draw a tofu box -- so the same markup was a different mark on
 * different machines. Paths are the same everywhere.
 *
 * ## Kept in step with app/icon.svg by hand
 *
 * The path data below is duplicated there, because Next's favicon convention
 * needs a literal `.svg` file on disk and a file cannot import from a React
 * component. Duplication is the price of the convention; the rule is simply
 * that a change to one is a change to both, and the two files say so. The
 * artwork is deliberately chunky so it survives being drawn at 16px in a
 * browser tab -- that constraint is why it looks the way it does at any size.
 */
export default function Logo({
    size = 28,
    className = "",
}: {
    /** Rendered box in pixels; the artwork scales to it. */
    size?: number;
    /** Extra classes on the tile -- e.g. a different radius on a larger one. */
    className?: string;
}) {
    return (
        <svg
            viewBox="0 0 32 32"
            width={size}
            height={size}
            className={className}
            role="img"
            aria-label="SongRank"
        >
            <rect width="32" height="32" rx="9" className="fill-accent" />
            <g className="fill-accent-fg">
                {/* Beam first, so the stems tuck under it and the join stays
                    solid at small sizes instead of showing a seam. */}
                <path d="M12.7 9.0 L26.3 7.0 L26.3 10.4 L12.7 12.4 Z" />
                <rect x="12.7" y="9.0" width="2.6" height="13.3" />
                <rect x="23.7" y="7.0" width="2.6" height="13.3" />
                <ellipse cx="10.0" cy="22.3" rx="4.3" ry="3.3" transform="rotate(-20 10.0 22.3)" />
                <ellipse cx="21.0" cy="20.3" rx="4.3" ry="3.3" transform="rotate(-20 21.0 20.3)" />
            </g>
        </svg>
    );
}
