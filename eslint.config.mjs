import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Next 16 removed `next lint`; linting runs through the ESLint CLI against
// this flat config instead.
//
// This imports eslint-config-next's native flat-config exports directly,
// per node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md
// for this exact Next version -- NOT the FlatCompat/`compat.extends(...)`
// bridge shown in older Next.js tutorials and AI training data. That bridge
// re-wraps eslint-config-next's legacy eslintrc-format string presets
// ("next/core-web-vitals") back into flat config, and against the
// eslint-plugin-react-hooks version this project's eslint-config-next
// resolves to (a flat-config-only major rewrite), the re-wrap produces a
// plugin object with an intentional circular self-reference that flat
// config tolerates but the legacy config-validator's error formatter does
// not -- `eslint .` crashes with "TypeError: Converting circular structure
// to JSON" before linting a single file, on totally valid source. Importing
// the flat presets directly skips that bridge altogether.
const eslintConfig = defineConfig([
    ...nextVitals,
    ...nextTypescript,
    globalIgnores([".next/**", "node_modules/**", "next-env.d.ts"]),
]);

export default eslintConfig;
