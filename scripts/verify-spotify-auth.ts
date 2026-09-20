// scripts/verify-spotify-auth.ts
//
// Proof that the Spotify authorisation plumbing handles its secrets safely,
// run with:
//
//     AUTH_SECRET=... node --experimental-strip-types scripts/verify-spotify-auth.ts
//
// The OAuth round trip itself cannot be tested here -- accounts.spotify.com is
// unreachable from some sandboxes, exactly like the API. What CAN be tested is
// everything that decides whether a stolen database is also a stolen Spotify
// account, and whether a crafted callback can attach someone else's account to
// your own. Both fail silently when wrong: encryption that does not
// authenticate still round-trips, and a state check that always passes still
// completes a normal login.

import {
    encryptToken,
    decryptToken,
    statesMatch,
    isExpired,
    expiryFrom,
    authorizeUrl,
    redirectUri,
    SCOPES,
    EXPIRY_MARGIN_MS,
} from "../lib/spotifyAuth.ts";

process.env.AUTH_SECRET ||= "verify-only-secret-not-a-real-one";
process.env.SPOTIFY_CLIENT_ID ||= "test-client-id";

let checks = 0;
const failures: string[] = [];
function check(label: string, actual: unknown, expected: unknown): void {
    checks += 1;
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
}

// --- encryption round trip ------------------------------------------------
const TOKEN = "AQC7x_fake_refresh_token_value_0123456789";
check("round trips", decryptToken(encryptToken(TOKEN)), TOKEN);
check("empty string survives", decryptToken(encryptToken("")), "");
check("unicode survives", decryptToken(encryptToken("tökén–✓")), "tökén–✓");

// The ciphertext must not be the plaintext, which sounds absurd until someone
// "simplifies" the function.
check("ciphertext is not the plaintext", encryptToken(TOKEN).includes(TOKEN), false);

// A random IV per call means the same token stored twice looks different, so
// the column cannot be used to tell whether two people hold the same value.
check("same input encrypts differently each time", encryptToken(TOKEN) === encryptToken(TOKEN), false);
check("...and both still decrypt", [decryptToken(encryptToken(TOKEN)), decryptToken(encryptToken(TOKEN))], [TOKEN, TOKEN]);

// --- tampering ------------------------------------------------------------
// GCM is authenticated: altered ciphertext must FAIL, not decrypt to something
// else that then gets sent to Spotify as a bearer credential.
const sealed = encryptToken(TOKEN);
const [iv, tag, data] = sealed.split(".");
// Asserted before the tamper checks use these, so a sealed value that isn't
// sealed at all -- someone "simplifying" encryptToken to return its input --
// is reported as a named failure rather than crashing this file with a
// TypeError three lines later. A stack trace says something broke; this says
// what.
check("a sealed token has all three parts", [iv, tag, data].every((part) => typeof part === "string"), true);
const flip = (s: string | undefined) => (s === undefined ? "" : (s[0] === "A" ? "B" : "A") + s.slice(1));
check("tampered ciphertext is rejected", decryptToken([iv, tag, flip(data)].join(".")), null);
check("tampered auth tag is rejected", decryptToken([iv, flip(tag), data].join(".")), null);
check("tampered iv is rejected", decryptToken([flip(iv), tag, data].join(".")), null);
check("truncated input is rejected", decryptToken(sealed.slice(0, 20)), null);
check("garbage is rejected", decryptToken("not-even-close"), null);
check("empty is rejected", decryptToken(""), null);
check("missing parts are rejected", decryptToken(`${iv}.${tag}`), null);

// --- a rotated AUTH_SECRET ------------------------------------------------
// Must read as "reconnect Spotify", an ordinary recoverable state, rather than
// throwing on a page that only wanted to know whether to show a button.
const underOldKey = encryptToken(TOKEN);
const originalSecret = process.env.AUTH_SECRET;
process.env.AUTH_SECRET = "a-completely-different-secret";
check("a rotated secret makes tokens unreadable, not explosive", decryptToken(underOldKey), null);
process.env.AUTH_SECRET = originalSecret;
check("...and the original secret still reads them", decryptToken(underOldKey), TOKEN);

// --- CSRF state -----------------------------------------------------------
check("matching states pass", statesMatch("abc123", "abc123"), true);
check("different states fail", statesMatch("abc123", "abc124"), false);
check("different lengths fail rather than throw", statesMatch("abc", "abcdef"), false);
// The dangerous cases: a missing cookie or a missing parameter must NOT be
// treated as agreement. "Neither side has a state" is exactly the shape of a
// crafted callback.
check("no issued state fails", statesMatch(undefined, "abc123"), false);
check("no returned state fails", statesMatch("abc123", undefined), false);
check("neither fails", statesMatch(undefined, undefined), false);
check("empty strings fail", statesMatch("", ""), false);

// --- expiry ---------------------------------------------------------------
const now = new Date("2026-01-01T12:00:00Z");
check("an hour out is not expired", isExpired(new Date(now.getTime() + 3_600_000), now), false);
check("already past is expired", isExpired(new Date(now.getTime() - 1000), now), true);
// The margin is the point: a token valid for another 30 seconds must be
// treated as expired, because an export is many sequential requests and
// expiring halfway through leaves a half-written playlist.
check("inside the margin counts as expired", isExpired(new Date(now.getTime() + 30_000), now), true);
check("just outside the margin does not", isExpired(new Date(now.getTime() + EXPIRY_MARGIN_MS + 5_000), now), false);
check("an unparseable expiry is treated as expired", isExpired("not a date", now), true);
check("expiry is computed from seconds", expiryFrom(3600, now).toISOString(), "2026-01-01T13:00:00.000Z");
check("a nonsense lifetime falls back to an hour", expiryFrom(-5, now).toISOString(), "2026-01-01T13:00:00.000Z");

// --- the authorize URL ----------------------------------------------------
const url = new URL(authorizeUrl("https://song-rankings.vercel.app", "state-value"));
check("points at Spotify", url.origin + url.pathname, "https://accounts.spotify.com/authorize");
check("asks for a code", url.searchParams.get("response_type"), "code");
check("carries the state", url.searchParams.get("state"), "state-value");
check("redirect matches the documented callback", url.searchParams.get("redirect_uri"), "https://song-rankings.vercel.app/api/spotify/callback");
// Scope creep is a real risk and an authorisation screen listing permissions a
// feature does not need is how people learn not to read them.
check("asks for exactly the two playlist scopes", url.searchParams.get("scope"), SCOPES.join(" "));
check("...and nothing else", SCOPES.length, 2);
check("forces the dialogue", url.searchParams.get("show_dialog"), "true");
// A path or trailing slash on the origin must not end up in the redirect URI,
// which Spotify matches exactly.
check("origin is normalised", redirectUri("https://song-rankings.vercel.app/my-rankings?x=1"), "https://song-rankings.vercel.app/api/spotify/callback");
check("localhost works too", redirectUri("http://localhost:3003/"), "http://localhost:3003/api/spotify/callback");

if (failures.length > 0) {
    console.error(`\n${failures.length} of ${checks} checks FAILED:\n`);
    for (const f of failures) console.error(`  ${f}\n`);
    process.exit(1);
}
console.log(`\n${checks}/${checks} checks passed.`);
console.log("Tokens are sealed and tamper-evident, a missing CSRF state never passes, and the grant stays narrow.");
