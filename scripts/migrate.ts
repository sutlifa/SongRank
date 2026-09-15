// Applies lib/db/schema.sql against DATABASE_URL. Uses the `postgres`
// package directly rather than shelling out to `psql`, so it works without
// requiring a local Postgres client install.
//
// `import.meta.dirname` rather than `__dirname`: this script runs straight
// through node's TypeScript stripping (`node --experimental-strip-types`),
// which treats the file as an ES module, and `__dirname` doesn't exist in an
// ES module -- `import.meta.dirname` is its Node 20.11+ replacement.
import { sql } from "../lib/db.ts";

async function main() {
    await sql.file(`${import.meta.dirname}/../lib/db/schema.sql`);
    console.log("Schema applied.");
    await sql.end();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
