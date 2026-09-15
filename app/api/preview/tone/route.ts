import { NextResponse } from "next/server";

/**
 * GET /api/preview/tone?freq=440&wave=sine&id=fx-1
 *
 * Synthesizes a short WAV tone on the fly and serves it as `audio/wav`. This
 * exists solely to back lib/fixtures.ts's `SONGRANK_PREVIEW_FIXTURES` test
 * path -- see that file's header for the full reasoning (this sandbox's
 * proxy blocks itunes.apple.com, so a fixture song needs *some* playable
 * audio to exercise the clip player, the A/B switching, and the 15-of-30s
 * window logic without a real network call). No binary asset is committed
 * for this; the handful of lines below generate one on request instead.
 *
 * This route is never linked from anywhere in production: fixture search
 * results (the only thing that ever points a <audio> tag at this URL) are
 * only produced when SONGRANK_PREVIEW_FIXTURES=1, which is never set on the
 * live deployment. The route itself is left unguarded because it is a pure,
 * side-effect-free function of its query string -- there is nothing here to
 * protect -- but it should never be treated as a real preview source; it has
 * no idea what song it's "for" beyond the frequency it was told to play.
 */

const SAMPLE_RATE = 22050;
const BITS_PER_SAMPLE = 16;

function clamp(n: number, min: number, max: number): number {
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

type Wave = "sine" | "square" | "triangle";

function sampleAt(t: number, freq: number, wave: Wave): number {
    const phase = (t * freq) % 1;
    switch (wave) {
        case "square":
            return phase < 0.5 ? 1 : -1;
        case "triangle":
            return 4 * Math.abs(phase - 0.5) - 1;
        case "sine":
        default:
            return Math.sin(2 * Math.PI * phase);
    }
}

/** Builds a mono 16-bit PCM WAV buffer of a pure tone, faded in/out to avoid clicks. */
function synthesizeWav(freq: number, wave: Wave, seconds: number): Buffer {
    const frameCount = Math.round(SAMPLE_RATE * seconds);
    const dataSize = frameCount * (BITS_PER_SAMPLE / 8);
    const buffer = Buffer.alloc(44 + dataSize);

    // RIFF/WAVE header -- the standard 44-byte PCM header.
    buffer.write("RIFF", 0, "ascii");
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8, "ascii");
    buffer.write("fmt ", 12, "ascii");
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(SAMPLE_RATE, 24);
    buffer.writeUInt32LE(SAMPLE_RATE * (BITS_PER_SAMPLE / 8), 28); // byte rate
    buffer.writeUInt16LE(BITS_PER_SAMPLE / 8, 32); // block align
    buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
    buffer.write("data", 36, "ascii");
    buffer.writeUInt32LE(dataSize, 40);

    // 15ms fade in/out so every clip starts and ends silent rather than on a
    // waveform discontinuity, which is what produces an audible "click".
    const fadeFrames = Math.round(SAMPLE_RATE * 0.015);

    for (let i = 0; i < frameCount; i++) {
        const t = i / SAMPLE_RATE;
        let amplitude = sampleAt(t, freq, wave);
        if (i < fadeFrames) amplitude *= i / fadeFrames;
        else if (i > frameCount - fadeFrames) amplitude *= (frameCount - i) / fadeFrames;

        // Leave headroom (0.6 rather than 1.0) so the square/triangle waves,
        // which have more high-frequency energy than a sine at the same
        // amplitude, don't sound harsh at full volume.
        const sample = Math.round(clamp(amplitude * 0.6, -1, 1) * 32767);
        buffer.writeInt16LE(sample, 44 + i * 2);
    }

    return buffer;
}

export async function GET(req: Request) {
    const params = new URL(req.url).searchParams;
    const freq = clamp(Number(params.get("freq")), 80, 2000);
    const waveParam = params.get("wave");
    const wave: Wave = waveParam === "square" || waveParam === "triangle" ? waveParam : "sine";
    // Fixtures always ask for a 30s tone (matching a real iTunes preview's
    // length), but the duration is still clamped defensively since it comes
    // straight from a query string.
    const seconds = clamp(Number(params.get("ms")) / 1000 || 30, 1, 30);

    const wav = synthesizeWav(freq || 440, wave, seconds);

    return new NextResponse(new Uint8Array(wav), {
        headers: {
            "Content-Type": "audio/wav",
            "Content-Length": String(wav.length),
            // Deterministic output for a given query string -- safe to cache
            // hard, including in the browser between replays of the same clip.
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
}
