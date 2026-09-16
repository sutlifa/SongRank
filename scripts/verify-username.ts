// scripts/verify-username.ts
//
// Rules check for lib/username.ts, run with:
//
//     node --experimental-strip-types scripts/verify-username.ts
//
// A username is permanent-ish, public, and goes in a URL. Every rule here
// exists to stop a specific bad outcome, and each one is easy to lose in a
// later edit without anything failing: an all-digit handle makes /u/<handle>
// ambiguous with a user id, a reserved word lets someone be "@support", and a
// case-sensitive comparison lets "@Sam" and "@sam" be two people.

import {
    checkUsername,
    normaliseUsername,
    suggestUsername,
    USERNAME_MIN,
    USERNAME_MAX,
} from "../lib/username.ts";

let failures = 0;
function check(condition: boolean, message: string): void {
    if (!condition) {
        failures += 1;
        console.error(`FAIL: ${message}`);
    }
}
const ok = (name: string) => check(checkUsername(name) === null, `"${name}" should be allowed, got: ${checkUsername(name)}`);
const no = (name: string, why: string) => check(checkUsername(name) !== null, `"${name}" should be rejected (${why})`);

console.log("Accepted:");
for (const name of ["sam", "sam_smith", "a1b", "x_9", "sutlifa", "s".repeat(USERNAME_MAX), "song_fan_2026"]) ok(name);
console.log(`  ${["sam", "sam_smith", "a1b", "x_9", "song_fan_2026"].join(", ")}, and a ${USERNAME_MAX}-character name`);

console.log("\nRejected:");
no("", "empty");
no("  ", "whitespace only");
no("ab", `shorter than ${USERNAME_MIN}`);
no("s".repeat(USERNAME_MAX + 1), `longer than ${USERNAME_MAX}`);
no("sam smith", "contains a space");
no("sam-smith", "contains a hyphen");
no("sam.smith", "contains a dot");
no("sam@smith", "contains an at sign");
no("sam/../admin", "contains path characters");
no("sam​", "contains a zero-width character");
no("123", "all digits -- would be ambiguous with a user id");
no("42", "all digits");
no("_sam", "leading underscore");
no("sam_", "trailing underscore");
no("sam__smith", "double underscore");
no("admin", "reserved");
no("support", "reserved -- '@support asking for your password' is a phishing kit");
no("browse", "reserved route name");
no("new", "reserved route name");
no("undefined", "reserved");
console.log("  spaces, punctuation, all-digit names, edge underscores and reserved words");

console.log("\nCase and whitespace:");
check(normaliseUsername("  SaM  ") === "sam", `normalise gave "${normaliseUsername("  SaM  ")}"`);
check(normaliseUsername("SAM") === normaliseUsername("sam"), "case must not make two different handles");
// The validator must judge the normalised form, so a name that is only
// acceptable after trimming and lowercasing is still accepted.
ok("  SamSmith  ");
check(checkUsername("ADMIN") !== null, "a reserved word must stay reserved in any case");
console.log('  "  SaM  " -> "sam"; reserved words stay reserved whatever the case');

console.log("\nSuggestions:");
check(suggestUsername("Alice Adams") === "alice_adams", `got ${suggestUsername("Alice Adams")}`);
check(suggestUsername("sutlifa@gmail.com") === "sutlifa", `got ${suggestUsername("sutlifa@gmail.com")}`);
check(suggestUsername("Ann-Marie O'Neill") === "ann_marie_o_neill", `got ${suggestUsername("Ann-Marie O'Neill")}`);
check(suggestUsername(null) === null, "no source means no suggestion");
check(suggestUsername("") === null, "an empty source means no suggestion");
check(suggestUsername("A") === null, "a source too short to make a valid handle suggests nothing");
check(suggestUsername("12345") === null, "an all-digit source must not suggest an invalid handle");
check(suggestUsername("admin") === null, "a source that normalises to a reserved word suggests nothing");
// Whatever comes back must itself be valid -- a suggestion the form then
// rejects would be a worse first impression than an empty box.
for (const source of ["Alice Adams", "sutlifa@gmail.com", "Ann-Marie O'Neill", "x".repeat(60), "Bob"]) {
    const s = suggestUsername(source);
    if (s !== null) check(checkUsername(s) === null, `suggestion "${s}" from "${source}" is not itself valid`);
}
console.log("  suggestions are always either null or valid; never a name the form would reject");

if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
}
console.log("\nAll username rules hold.");
