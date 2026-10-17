// Loads TypeScript from TS_PATH (must be typescript@5.x: TS 7 has no transpileModule and cannot be required as a directory).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
export function loadTs() {
  const p = process.env.TS_PATH;
  if (!p) throw new Error("TS_PATH not set (point it at .../node_modules/typescript from `npm i typescript@5`)");
  const pkg = JSON.parse(fs.readFileSync(path.join(p, "package.json"), "utf8"));
  const major = Number(String(pkg.version).split(".")[0]);
  if (major !== 5) throw new Error(`TS_PATH has typescript ${pkg.version}; the cross-check needs typescript@5 (TS ${major} lacks transpileModule). Run: npm i typescript@5`);
  return createRequire(import.meta.url)(path.join(p, "lib", "typescript.js"));
}
export function transpile(ts, src) {
  return ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
}
export const dataUrl = (js) => "data:text/javascript;base64," + Buffer.from(js).toString("base64");
