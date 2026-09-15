// lib/name.ts
//
// Tournament-name validation, pulled out of lib/auth-guard.ts into its own
// framework-free module so it can be imported from a client component (the
// inline rename affordance on /t/[id] and /t/[id]/results) as well as from
// server routes. auth-guard.ts imports `next/server` and `@/auth`, both of
// which drag in server-only code -- bundling that into a "use client"
// component fails the build, not just wastes bytes -- so the one thing both
// sides actually need (the same MAX_NAME_LENGTH and the same validation
// logic, so a name the client accepts is never rejected by the server and
// vice versa) has to live somewhere neither side's imports poison.

export const MAX_NAME_LENGTH = 120;

/** Validates a user-supplied tournament name, returning an error message or null. */
export function checkName(name: unknown): string | null {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) return "Give it a name";
    if (trimmed.length > MAX_NAME_LENGTH) {
        return `Name is too long (max ${MAX_NAME_LENGTH} characters)`;
    }
    return null;
}
