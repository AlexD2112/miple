// Cross-check: runs the REAL server/src/domain/allergens.ts (transpiled with TypeScript) over JSONL cases on stdin.
// Usage: TS_PATH=/path/to/node_modules/typescript node app_allergens_check.mjs < cases.jsonl  -> JSONL {id, violates, hits}
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const ts = require(process.env.TS_PATH || "typescript");
const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "../../../server/src/domain/allergens.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const lines = fs.readFileSync(0, "utf8").split("\n").filter(Boolean);
const out = [];
for (const l of lines) {
  const c = JSON.parse(l); const r = c.recipe; const al = c.profile.allergies;
  const texts = [r.title, ...r.ingredients.map((i) => i.name), ...(r.steps ?? [])];
  out.push(JSON.stringify({ id: c.id, violates: mod.violatesAllergies(r, al), hits: mod.findAllergens(texts, al) }));
}
process.stdout.write(out.join("\n") + "\n");
