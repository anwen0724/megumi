// Regenerates src/providers/data/.manifest.json for the trimmed provider set.
// Uses the same helpers as scripts/generate-models.ts so check:model-data passes.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createModelDataManifest, MODEL_DATA_MANIFEST_FILE, readModelDataStructure } from "./model-data.ts";

const packageRoot = join(import.meta.dirname, "..");
const dataDir = join(packageRoot, "src", "providers", "data");
const structure = readModelDataStructure(packageRoot);
const fileContents: Record<string, string> = {};
for (const file of readdirSync(dataDir).filter((f) => f.endsWith(".json") && f !== MODEL_DATA_MANIFEST_FILE)) {
	fileContents[file] = readFileSync(join(dataDir, file), "utf8");
}
const manifest = createModelDataManifest(structure, fileContents, new Date().toISOString());
writeFileSync(join(dataDir, MODEL_DATA_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${MODEL_DATA_MANIFEST_FILE} with ${Object.keys(structure).length} providers`);
