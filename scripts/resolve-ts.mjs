// scripts/resolve-ts.mjs
//
// A resolver hook for `node --experimental-strip-types`, needed by
// scripts/verify-sharing.ts and nothing else.
//
// lib/queries.ts imports "./db", meaning lib/db.ts. Node's ESM resolver sees
// the lib/db/ DIRECTORY (which holds schema.sql) first and fails with
// ERR_UNSUPPORTED_DIR_IMPORT. Next's bundler resolves the same specifier to
// the .ts file, which is why the app itself is fine and only a bare-node
// harness trips over it. The other verify scripts don't import anything that
// touches lib/db.ts, so this is only loaded where it's actually needed.
//
// Used as:  node --experimental-strip-types --import ./scripts/register-ts.mjs ...
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

export async function resolve(specifier, context, next) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
        const candidate = resolvePath(dirname(fileURLToPath(context.parentURL)), `${specifier}.ts`);
        if (existsSync(candidate)) return next(pathToFileURL(candidate).href, context);
    }
    return next(specifier, context);
}
