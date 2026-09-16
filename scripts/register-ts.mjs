// Registers scripts/resolve-ts.mjs -- see that file for what it fixes and why.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./resolve-ts.mjs", pathToFileURL(`${import.meta.dirname}/`));
