import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SUBJECT } from "../src/subject.ts";

const out = join(import.meta.dir, "..", "manifest.json");
writeFileSync(out, JSON.stringify(SUBJECT.manifest(), null, 2) + "\n");
console.log(`wrote ${out}`);
