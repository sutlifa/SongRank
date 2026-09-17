// scripts/verify-legacy.ts
//
// Proof that rankings saved BEFORE the top-cut playoff was retired still
// replay to exactly the same answer, run with:
//
//     node --experimental-strip-types scripts/verify-legacy.ts
//
// The fixtures in scripts/fixtures/legacy-playoff-rankings.json were played
// out by the engine as it stood when it still scheduled a playoff, and their
// expected answers were recorded by that engine. They cannot be regenerated
// -- the code that produced them is gone -- which is exactly what makes them
// worth keeping: they are a frozen sample of the shape of data already
// sitting in users' accounts, including the "p"-prefixed votes no new ranking
// will ever create again.
//
// What this protects is the one promise the change had to keep: a ranking
// that was FINISHED stays finished, with the same champion and the same
// standings. A user's completed ranking silently reopening -- or quietly
// crowning a different song -- is the failure mode here, and it is not one
// anybody would notice from a passing build.
//
// Exits non-zero naming every fixture that moved.

import { deriveRanking } from "../lib/ranking.ts";
import type { Song, Tournament, Vote } from "../lib/types.ts";
import { readFileSync } from "node:fs";

interface Fixture {
    label: string;
    n: number;
    votes: Vote[];
    expect: {
        status: string;
        championId: string | null;
        matchupsPlayed: number;
        inPlayoffs: boolean;
        currentPairing: string | null;
        standings: string[];
    };
}

/** The same synthetic field the fixtures were played on; song ids are all the
 * vote log actually refers to, so this needs no stored song data. */
function fieldOf(n: number): Song[] {
    return Array.from({ length: n }, (_, i) => ({
        id: `song-${i}`,
        title: `S${i}`,
        artist: "A",
        album: null,
        artworkUrl: null,
        previewUrl: null,
        previewSeconds: null,
        previewNote: null,
        itunesId: null,
    }));
}

const fixtures = JSON.parse(
    readFileSync(new URL("./fixtures/legacy-playoff-rankings.json", import.meta.url), "utf8")
) as Fixture[];

let failures = 0;
let withPlayoffVotes = 0;

for (const f of fixtures) {
    const t: Tournament = {
        id: f.label,
        name: "legacy",
        createdAt: "",
        updatedAt: "",
        clipSeconds: 30,
        format: "adaptive",
        depth: "thorough",
        songs: fieldOf(f.n),
        votes: f.votes,
    };
    if (f.votes.some((v) => v.pairingId.startsWith("p"))) withPlayoffVotes += 1;

    const d = deriveRanking(t);
    const now = {
        status: d.status,
        championId: d.championId,
        matchupsPlayed: d.matchupsPlayed,
        standings: d.standings.map(
            (s) => `${s.rank}:${s.songId}:${s.wins}-${s.losses}-${s.ties}:${s.rating}:${s.rd}`
        ),
    };

    const diffs: string[] = [];
    if (now.status !== f.expect.status) diffs.push(`status ${f.expect.status} -> ${now.status}`);
    if (now.championId !== f.expect.championId)
        diffs.push(`champion ${f.expect.championId} -> ${now.championId}`);
    if (now.matchupsPlayed !== f.expect.matchupsPlayed)
        diffs.push(`matchups played ${f.expect.matchupsPlayed} -> ${now.matchupsPlayed}`);
    if (JSON.stringify(now.standings) !== JSON.stringify(f.expect.standings))
        diffs.push("standings changed");

    if (diffs.length > 0) {
        failures += 1;
        console.error(`  FAIL ${f.label}: ${diffs.join("; ")}`);
    } else {
        console.log(
            `  ok   ${f.label.padEnd(22)} ${String(f.votes.length).padStart(3)} votes  status=${now.status}  champion=${now.championId ?? "-"}`
        );
    }
}

if (failures > 0) {
    console.error(`\n${failures} of ${fixtures.length} legacy rankings CHANGED.`);
    process.exit(1);
}
console.log(`\n${fixtures.length}/${fixtures.length} legacy rankings replay identically.`);
console.log(`${withPlayoffVotes} of them carry playoff votes no new ranking will ever produce again.`);
