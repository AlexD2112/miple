// Cross-check calendar_windows/cases.jsonl against the REAL mobile/src/lib/calendar.ts (needs TS_PATH -> typescript@5).
// expo-calendar / react-native are replaced by stubs; each device time zone runs in its own node process with TZ set.
import fs from "node:fs"; import path from "node:path"; import { spawnSync } from "node:child_process";
import { loadTs, transpile, dataUrl } from "./ts_load.mjs";
const here = path.dirname(new URL(import.meta.url).pathname); const large4 = path.dirname(here); const repo = path.resolve(large4, "..", "..");
const casesPath = path.join(large4, "calendar_windows/cases.jsonl");
if (process.argv[2] === "--worker") {
  const tz = process.argv[3];
  let src = fs.readFileSync(path.join(repo, "mobile/src/lib/calendar.ts"), "utf8");
  src = src.replace(/import \* as Calendar from "expo-calendar";/, "const Calendar = new Proxy({}, { get: (_t, k) => globalThis.__Calendar[k] });")
           .replace(/import \{ Platform \} from "react-native";/, 'const Platform = { OS: "ios" };');
  if (!src.includes("globalThis.__Calendar")) throw new Error("calendar.ts imports changed; update stub");
  const mod = await import(dataUrl(transpile(loadTs(), src)));
  console.warn = () => {};
  const rows = fs.readFileSync(casesPath, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => r.device_tz === tz);
  const out = [];
  for (const r of rows) {
    let rangeSeen = null;
    globalThis.__Calendar = {
      EntityTypes: { EVENT: "event" }, Availability: { FREE: "free", BUSY: "busy", TENTATIVE: "tentative", UNAVAILABLE: "unavailable", NOT_SUPPORTED: "notSupported" },
      getCalendarPermissions: async () => ({ granted: r.calendar_access !== "denied" }),
      requestCalendarPermissions: async () => ({ granted: r.calendar_access !== "denied" }),
      getCalendars: async () => [{ id: "cal-1" }],
      listEvents: async (_c, s, e) => {
        rangeSeen = [s.getTime(), e.getTime()];
        if (r.calendar_access === "read_error") throw new Error("simulated read failure");
        return r.listed_events.map((x) => ({ id: x.event_id, startDate: x.startDate, endDate: x.endDate, allDay: x.allDay, availability: x.availability }));
      },
    };
    const w = await mod.findFreeMealWindows(r.days, new Date(r.now_ms));
    out.push({ id: r.id, range: rangeSeen, windows: w.map((x) => ({ start_ms: x.start.getTime(), end_ms: x.end.getTime(), minutes: x.minutes, meal: x.meal })) });
  }
  process.stdout.write(JSON.stringify(out));
} else {
  loadTs();
  const rows = fs.readFileSync(casesPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const tzs = [...new Set(rows.map((r) => r.device_tz))].sort();
  const byId = new Map(rows.map((r) => [r.id, r])); let n = 0; const bad = [];
  for (const tz of tzs) {
    const p = spawnSync(process.execPath, [new URL(import.meta.url).pathname, "--worker", tz], { env: { ...process.env, TZ: tz }, encoding: "utf8", maxBuffer: 1 << 28 });
    if (p.status !== 0) { console.log(JSON.stringify({ error: `worker ${tz}: ${p.stderr.slice(-400)}` })); process.exit(1); }
    for (const g of JSON.parse(p.stdout)) {
      const r = byId.get(g.id); n++;
      const want = r.expected.windows.map((x) => ({ start_ms: x.start_ms, end_ms: x.end_ms, minutes: x.minutes, meal: x.meal }));
      const rangeOk = r.calendar_access === "denied" || (g.range && g.range[0] === r.range.start_ms && g.range[1] === r.range.end_ms);
      if (JSON.stringify(want) !== JSON.stringify(g.windows) || !rangeOk) bad.push({ id: g.id, tz, got: g.windows.slice(0, 2), want: want.slice(0, 2), range: g.range, want_range: r.range });
    }
  }
  console.log(JSON.stringify({ checked: n, zones: tzs.length, mismatch_count: bad.length, mismatches: bad.slice(0, 3) }));
}
