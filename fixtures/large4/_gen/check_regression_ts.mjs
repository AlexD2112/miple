// Cross-check allergen_regression against the REAL server/src/domain/allergens.ts (needs TS_PATH -> typescript@5):
// 1) app_current for every case/control equals findAllergens([text],[allergy]); 2) runs allergens.regression.test.ts with node --test.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawnSync } from "node:child_process";
import { loadTs, transpile } from "./ts_load.mjs";
const here = path.dirname(new URL(import.meta.url).pathname); const large4 = path.dirname(here); const repo = path.resolve(large4, "..", "..");
const ts = loadTs();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "miple-allergen-reg-"));
fs.writeFileSync(path.join(tmp, "allergens.js"), transpile(ts, fs.readFileSync(path.join(repo, "server/src/domain/allergens.ts"), "utf8")));
fs.writeFileSync(path.join(tmp, "package.json"), '{"type":"module"}');
const { findAllergens } = await import(path.join(tmp, "allergens.js"));
const d = JSON.parse(fs.readFileSync(path.join(large4, "allergen_regression/cases.json"), "utf8"));
let n = 0, bad = [];
for (const c of [...d.groups.flatMap((g) => g.cases), ...d.controls]) {
  n++; const got = findAllergens([c.text], [c.allergy]);
  if (JSON.stringify(got) !== JSON.stringify(c.app_current)) bad.push({ id: c.id ?? c.text, got, want: c.app_current });
}
fs.writeFileSync(path.join(tmp, "allergens.regression.test.js"), transpile(ts, fs.readFileSync(path.join(large4, "allergen_regression/allergens.regression.test.ts"), "utf8")));
const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", path.join(tmp, "allergens.regression.test.js")], { encoding: "utf8" });
const num = (k) => Number((r.stdout.match(new RegExp(`^# ${k} (\\d+)`, "m")) || [0, -1])[1]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(JSON.stringify({ checked: n, mismatches: bad.slice(0, 5), mismatch_count: bad.length, test_exit: r.status, pass: num("pass"), fail: num("fail"), todo: num("todo") }));
