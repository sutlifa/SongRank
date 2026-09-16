// lib/loudness.ts
//
// Measures how loud a preview actually is, so two songs in a matchup can be
// played at a comparable level. Mastering levels vary enormously between eras
// and genres -- a 1950s Disney recording against a modern pop master is a
// difference you hear as "one of these is broken" rather than as a fair
// comparison, and a quiet track loses votes for reasons that have nothing to
// do with the song.
//
// Two constraints shape the whole approach, and both are worth stating because
// the obvious implementation violates them:
//
// 1. `audio.volume` can only ATTENUATE (0..1); it cannot amplify. So the only
//    available move is to bring loud tracks DOWN to a shared target, never to
//    raise a quiet one up. Everything therefore normalises toward TARGET_RMS,
//    which is set deliberately low so most real tracks land above it and get
//    pulled down to meet each other.
//
// 2. The measurement must never be able to break playback. Routing the actual
//    <audio> element through Web Audio would require `crossOrigin="anonymous"`
//    on it, and if the server does not answer with CORS headers that makes the
//    file fail to load outright -- or, once routed through a tainted graph,
//    play silently. That is a catastrophic failure mode for a feature whose
//    entire benefit is cosmetic. So the element is left completely alone and
//    the analysis happens on a SEPARATE fetch. If that fetch is blocked, the
//    decode fails, or Web Audio is unavailable, the gain stays 1 and the song
//    plays exactly as it did before.

/**
 * Target level, in RMS amplitude (not dB), that every measured song is pulled
 * down to.
 *
 * This started at 0.08 and was too aggressive: typical commercial masters sit
 * around 0.15-0.25 RMS, so nearly every song was cut to the floor and the whole
 * app simply got quiet. 0.14 sits inside that normal band instead, so an
 * ordinary master is barely touched and only genuinely hot ones come down.
 * Evening out the loudest outliers is worth having; making everything quiet to
 * chase a perfectly flat result is not.
 */
const TARGET_RMS = 0.14;

/**
 * Never attenuate past this. A pathologically loud master could otherwise be
 * driven down to a whisper by a strict ratio, which trades one imbalance for
 * another. 0.5 bounds the correction to about -6 dB -- audible, but nowhere
 * near enough to make a song sound broken or unplayed.
 */
const MIN_GAIN = 0.5;

/** Measurements are keyed by preview URL and shared across every player. */
const cache = new Map<string, number>();
/** In-flight measurements, so two cards asking for the same URL fetch once. */
const inFlight = new Map<string, Promise<number>>();

let audioContext: AudioContext | null = null;

function getContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (audioContext) return audioContext;
    // Safari still exposes this prefixed. Missing entirely (or blocked) simply
    // means no normalisation, which is a fine outcome.
    const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
        audioContext = new Ctor();
        return audioContext;
    } catch {
        return null;
    }
}

/**
 * Root-mean-square amplitude across the decoded buffer.
 *
 * RMS rather than peak: peak measures the single loudest sample, which a
 * limiter puts at roughly the same place on almost every modern master and so
 * tells you nothing about perceived loudness. RMS tracks average energy, which
 * is much closer to what someone means by "this one is quieter".
 *
 * Only the first channel is read, and only every 64th sample. A preview is
 * hundreds of thousands of samples; a 1-in-64 stride is statistically
 * indistinguishable for an average this coarse and keeps the measurement off
 * the main thread's critical path.
 */
function rmsOf(buffer: AudioBuffer): number {
    const data = buffer.getChannelData(0);
    const stride = 64;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += stride) {
        sum += data[i] * data[i];
        count += 1;
    }
    return count > 0 ? Math.sqrt(sum / count) : 0;
}

/**
 * Returns the volume multiplier to play `url` at, in 0..1.
 *
 * Resolves to 1 for anything it cannot measure -- a blocked fetch, a decode
 * failure, no Web Audio, a track already at or below the target. Never
 * rejects: a caller should be able to `await` this and apply the result
 * without a try/catch, because failing to normalise is not an error worth
 * surfacing to anyone.
 */
export async function gainForPreview(url: string): Promise<number> {
    const cached = cache.get(url);
    if (cached !== undefined) return cached;

    const existing = inFlight.get(url);
    if (existing) return existing;

    const task = (async () => {
        const ctx = getContext();
        if (!ctx) return 1;
        try {
            // A plain no-cors-unsafe fetch: if the host does not allow it this
            // throws, we return 1, and the <audio> element -- which has its own
            // independent, non-CORS request -- is entirely unaffected.
            const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) return 1;
            const bytes = await res.arrayBuffer();
            const buffer = await ctx.decodeAudioData(bytes);
            const rms = rmsOf(buffer);
            if (!Number.isFinite(rms) || rms <= 0) return 1;
            // Only ever quieter: a track below the target is already as loud as
            // we are able to make it.
            return Math.min(1, Math.max(MIN_GAIN, TARGET_RMS / rms));
        } catch {
            return 1;
        }
    })();

    inFlight.set(url, task);
    const gain = await task;
    inFlight.delete(url);
    cache.set(url, gain);
    return gain;
}
