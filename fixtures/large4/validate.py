#!/usr/bin/env python3
"""Validate fixtures/large4, plus JSON-schema conformance: the large3 schemas (all earlier sets, and large3 sub-schemas applied to
large4 records where the shape is shared) and large4's own schemas. Labels are recomputed from ../shelf_life.json, ../allergens.json
and the app code. Optional cross-checks against the REAL app TypeScript need TS_PATH=<...>/node_modules/typescript from
`npm i typescript@5` (TypeScript 7 has no transpileModule; it is detected and reported).
Run: python3 -B fixtures/large4/validate.py"""
import json, os, re, sys, glob, subprocess, unicodedata, datetime as dt
from fractions import Fraction as F
from decimal import Decimal as D, ROUND_HALF_UP
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__)); FIX = os.path.dirname(HERE); REPO = os.path.dirname(FIX)
L3 = os.path.join(FIX, "large3")
sys.path.insert(0, os.path.join(L3, "_gen"))
errors, stats = [], {}
def check(c, m):
    if not c:
        stats["errors_total"] = stats.get("errors_total", 0) + 1
        if len(errors) < 200: errors.append(m)
def jsonl(path):
    out = []
    for n, line in enumerate(open(path, encoding="utf-8"), 1):
        try: out.append(json.loads(line))
        except Exception as e: check(False, f"{path}:{n} invalid JSON: {e}")
    return out
def rows_of(pattern):
    out = []
    for p in sorted(glob.glob(os.path.join(HERE, pattern))): out += jsonl(p)
    return out
shelf = json.load(open(os.path.join(FIX, "shelf_life.json")))
CATS = {c["category"]: c for c in shelf["categories"]}
for p in glob.glob(os.path.join(HERE, "**", "*.json"), recursive=True):
    try: json.load(open(p, encoding="utf-8"))
    except Exception as e: check(False, f"{p}: {e}")
for p in glob.glob(os.path.join(HERE, "**", "*.jsonl"), recursive=True): jsonl(p)
TOTAL = 0
for dp, _, fs in os.walk(HERE):
    if "node_modules" in dp: continue
    check("__pycache__" not in dp, f"{dp}: __pycache__ present")
    for f in fs:
        s = os.path.getsize(os.path.join(dp, f)); TOTAL += s; check(s < 50 * 1024 * 1024, f"{dp}/{f} >= 50MB")
        check(not f.endswith((".pyc", ".pyo")), f"{dp}/{f}: bytecode")
check(TOTAL < 150 * 1024 * 1024, f"total {TOTAL} >= 150MB")

def ts_path():
    """TS_PATH must be typescript@5.x; returns None when unset, records a clear error when it is another major version."""
    p = os.environ.get("TS_PATH")
    if not p: return None
    try: v = json.load(open(os.path.join(p, "package.json")))["version"]
    except Exception as e: check(False, f"TS_PATH={p}: cannot read package.json ({e}); install with `npm i typescript@5`"); return None
    if not v.startswith("5."):
        check(False, f"TS_PATH has typescript {v}; the cross-check needs typescript@5 (TS {v.split('.')[0]} has no transpileModule). Run `npm i typescript@5`.")
        return None
    stats["typescript"] = v; return p
def node(script, stdin=None):
    r = subprocess.run(["node", os.path.join(HERE, "_gen", script)], input=stdin, capture_output=True, text=True, env=dict(os.environ))
    check(r.returncode == 0, f"{script}: exit {r.returncode}: {r.stderr[-400:]}")
    return r.stdout

# ---------------------------------------------------------------- 1. allergen regression suite
def validate_allergen_regression():
    p = os.path.join(HERE, "allergen_regression", "cases.json")
    if not os.path.exists(p): return
    from app_allergens import find_allergens, KEYWORDS
    sys.path.insert(0, os.path.join(FIX, "large", "_gen")); from allergen_matcher import analyze
    T = json.load(open(os.path.join(L3, "llm_safety", "lookup_tables.json"), encoding="utf-8"))
    EXP, FOR = T["expansions"], T["foreign"]; MIS = {s: c for c, ss in T["misspellings"].items() for s in ss}
    GL = [w for w in KEYWORDS["gluten"] if w not in KEYWORDS["wheat"]]
    CYR = {"а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y"}
    def clean(s):  # independent normalization: NFKC, drop marks/format chars, Cyrillic look-alikes, NBSP
        s = unicodedata.normalize("NFD", unicodedata.normalize("NFKC", s))
        return "".join(CYR.get(ch, ch) for ch in s if unicodedata.category(ch) not in ("Mn", "Cf")).replace("\xa0", " ").lower()
    def ref(c, seen=()):
        comps = EXP.get(c.lower()); cont = set()
        for x in (comps if comps else [c]):
            if comps and x.lower() in EXP and x.lower() not in seen: cont |= ref(x, seen + (c.lower(),)); continue
            a = analyze(x); ks = set(a["app_keys"]) | ({"shellfish"} if a["mollusks"] else set())
            if "wheat" in ks or any(re.search(r"\b" + w + r"\b", x.lower()) for w in GL): ks.add("gluten")
            cont |= ks
        return cont
    d = json.load(open(p, encoding="utf-8")); seen = set(); n = 0; per = {}
    for g in d["groups"]:
        per[g["root_cause"]] = len(g["cases"])
        for e in g["cases"]:
            n += 1; key = (e["allergy"], e["text"]); check(key not in seen, f"dup {key}"); seen.add(key)
            check(find_allergens([e["text"]], [e["allergy"]]) == e["app_current"], f"{e['id']}: app_current mismatch")
            check(e["expected"] != e["app_current"], f"{e['id']}: not a failing case")
            raw = e["text"].lower(); t = clean(e["text"]); canon = FOR.get(raw) or MIS.get(raw) or FOR.get(t) or MIS.get(t) or t
            truth = e["allergy"] in ref(canon)
            check(truth == (e["expected"] == [e["allergy"]]), f"{e['id']}: reference disagrees ({canon})")
            rc = g["root_cause"]
            if rc == "unicode_normalization": check(t != e["text"].lower() and find_allergens([t], [e["allergy"]]), f"{e['id']}: not a unicode-only gap")
            if rc == "foreign_terms": check(raw in FOR, e["id"])
            if rc == "misspellings": check(raw in MIS, e["id"])
            if rc == "compound_dishes": check(t in EXP, e["id"])
            if rc == "over_broad_terms": check(not truth and any(t in x for x in T["traps"]), e["id"])
    for c in d["controls"]: check(find_allergens([c["text"]], [c["allergy"]]) == c["expected"] == c["app_current"], f"control {c}")
    src = {r["id"] for r in jsonl(os.path.join(L3, "llm_safety", "cases.jsonl")) if r["gap"]}
    cited = {x for g in d["groups"] for e in g["cases"] for x in e["source_cases"]} | {x for k in ("reference_silent", "reference_disputed") for e in d[k] for x in e["source_cases"]}
    check(cited <= src, "cites a non-gap case"); check(not d["unresolved_source_cases"], "unresolved batch-3 gaps")
    tsf = open(os.path.join(HERE, "allergen_regression", "allergens.regression.test.ts"), encoding="utf-8").read()
    check(len(re.findall(r'\{ id: "', tsf)) == n + len(d["controls"]), "test file case count != cases.json")
    stats["allergen_regression_cases"] = n; stats["allergen_regression_groups"] = per; stats["allergen_regression_controls"] = len(d["controls"])
    if ts_path():
        out = node("check_regression_ts.mjs"); 
        try:
            j = json.loads(out.strip().splitlines()[-1])
            check(j["mismatch_count"] == 0 and j["fail"] == 0 and j["pass"] == len(d["controls"]) and j["todo"] == n, f"TS regression run: {j}")
            stats["allergen_regression_ts"] = dict(pass_=j["pass"], fail=j["fail"], todo=j["todo"])
        except Exception as ex: check(False, f"TS regression run output: {out[-300:]} {ex}")

# ---------------------------------------------------------------- 2. Vision-shaped OCR simulation
def validate_ocr():
    rows = rows_of("ocr_vision/receipts_*.jsonl")
    if not rows: return
    import math
    src = {r["id"]: r for r in jsonl(os.path.join(FIX, "large", "receipts", "expected_clean.jsonl"))}
    n_obs = 0; issues = {}
    for r in rows:
        t = r["id"]; s0 = src[r["source"]["receipt_id"]]; obs = r["vision"]["observations"]; gt = r["ground_truth"]; n_obs += len(obs)
        for i in r["issues"]: issues[i] = issues.get(i, 0) + 1
        lines = open(os.path.join(FIX, r["source"]["file"]), encoding="utf-8").read().split("\n")
        while lines and not lines[-1].strip(): lines.pop()
        check([l["line_index"] for l in gt["lines"]] == [i for i, l in enumerate(lines) if l.strip()], f"{t}: line set")
        check(gt["items"] == s0["items"] and gt["total"] == s0["total"] and gt["store"] == s0["store"] and gt["date"] == s0["date"], f"{t}: parsed items/meta")
        check(len(gt["observations"]) == len(obs), f"{t}: gt observations length")
        refs = {}
        for l in gt["lines"]:
            line = lines[l["line_index"]]; check(l["text"] == line.strip(), f"{t}: line text {l['line_index']}")
            got = "".join(line[sg["char_start"]:sg["char_end"]] for sg in l["segments"])
            check(re.sub(r"\s+", "", got) == re.sub(r"\s+", "", line), f"{t}: segments don't cover line {l['line_index']}")
            xs = [sg["char_start"] for sg in l["segments"]]; check(xs == sorted(xs), f"{t}: segments not left-to-right")
            for sg in l["segments"]: refs.setdefault(sg["obs"], []).append((l["line_index"], line[sg["char_start"]:sg["char_end"]]))
        check(sorted(refs) == list(range(len(obs))), f"{t}: every observation must belong to a line")
        W, H = r["capture"]["image_width"], r["capture"]["image_height"]; rr = r["capture"]["receipt_rect"]
        nl = len(lines) + 2; lh = rr["height"] * H / nl; th = -math.radians(r["capture"]["skew_degrees"])
        for j, o in enumerate(obs):
            g = gt["observations"][j]; parts = refs[j]
            check(g["text"] == " ".join(x for _, x in parts) and g["lines"] == [i for i, _ in parts], f"{t}: obs {j} truth text")
            if len(parts) == 2: check(parts[1][0] - parts[0][0] >= 1 and all(not lines[k].strip() for k in range(parts[0][0] + 1, parts[1][0])), f"{t}: merge not adjacent")
            cs = [o[k] for k in ("topLeft", "topRight", "bottomRight", "bottomLeft")]; bb = o["boundingBox"]
            check(all(0 <= c["x"] <= 1 and 0 <= c["y"] <= 1 for c in cs), f"{t}: corner out of range")
            check(abs(bb["x"] - min(c["x"] for c in cs)) < 2e-4 and abs(bb["y"] - min(c["y"] for c in cs)) < 2e-4 and
                  abs(bb["x"] + bb["width"] - max(c["x"] for c in cs)) < 3e-4 and abs(bb["y"] + bb["height"] - max(c["y"] for c in cs)) < 3e-4, f"{t}: bbox != corners")
            check(cs[0]["y"] + cs[1]["y"] > cs[2]["y"] + cs[3]["y"], f"{t}: obs {j} top below bottom (origin must be bottom-left)")
            # undo skew and recover which printed row the observation sits on
            px = sum(c["x"] for c in cs) / 4 * W; py = (1 - sum(c["y"] for c in cs) / 4) * H
            dx, dy = px - W / 2, py - H / 2; uy = H / 2 + dx * math.sin(th) + dy * math.cos(th)
            row = (uy - rr["y"] * H) / lh - 1.5
            want = sum(g["lines"]) / len(g["lines"])
            check(abs(row - want) < 0.2, f"{t}: obs {j} geometric row {row:.2f} != line {want}")
            cands = o["topCandidates"]; cf = [c["confidence"] for c in cands]
            check(cf == sorted(cf, reverse=True) and all(0 < c <= 1 for c in cf), f"{t}: candidate confidences")
            check(g["top1_correct"] == (cands[0]["string"] == g["text"]) and g["truth_in_candidates"] == any(c["string"] == g["text"] for c in cands), f"{t}: candidate flags")
        order = list(dict.fromkeys(sg["obs"] for l in gt["lines"] for sg in l["segments"])); check(order == gt["reading_order"], f"{t}: reading order")
        out, seen = [], set()
        for l in gt["lines"]:
            ps = [obs[sg["obs"]]["topCandidates"][0]["string"] for sg in l["segments"] if sg["obs"] not in seen]; seen |= {sg["obs"] for sg in l["segments"]}
            if ps: out.append("  ".join(ps))
        check("\n".join(out) == r["app_text"], f"{t}: app_text")
        check(("out_of_order" in r["issues"]) == (order != list(range(len(obs)))), f"{t}: out_of_order flag")
    stats["ocr_receipts"] = len(rows); stats["ocr_observations"] = n_obs; stats["ocr_issues"] = issues

# ---------------------------------------------------------------- 3. calendar free meal windows
def validate_calendar():
    p = os.path.join(HERE, "calendar_windows", "cases.jsonl")
    if not os.path.exists(p): return
    from zoneinfo import ZoneInfo
    src = open(os.path.join(REPO, "mobile", "src", "lib", "calendar.ts")).read()
    MW = [(m, int(a) * 60 + int(b), int(c) * 60 + int(d)) for m, a, b, c, d in re.findall(r'meal: "(\w+)" as const, start: \[(\d+), (\d+)\], end: \[(\d+), (\d+)\]', src)]
    MINM = int(re.search(r"MIN_MINUTES = (\d+)", src).group(1)); MAXM = int(re.search(r"MAX_MINUTES = (\d+)", src).group(1)); FB = int(re.search(r"FALLBACK_MINUTES = (\d+)", src).group(1))
    M = 60_000; WD = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
    def wall_to_ms(z, d, minute_of_day, sec=0):
        return int(dt.datetime(d.year, d.month, d.day, minute_of_day // 60, minute_of_day % 60, sec, tzinfo=z).timestamp()) * 1000
    def occurrences(e, lo, hi):
        st = int(dt.datetime.fromisoformat(e["start"]).timestamp() * 1000); en = int(dt.datetime.fromisoformat(e["end"]).timestamp() * 1000)
        if "recurrence" not in e: return [(st, en)] if st < hi and en > lo else []
        z = ZoneInfo(e["tz"]); r = e["recurrence"]; w = dt.datetime.fromtimestamp(st // 1000, z); base = w.date(); out = []; n = 0
        last = dt.datetime.fromtimestamp(hi // 1000, z).date() + dt.timedelta(days=2)
        until = dt.date.fromisoformat(r["until"]) if r.get("until") else last
        d = base
        while d <= min(until, last):
            off = (d - base).days
            hit = (off % r["interval"] == 0) if r["freq"] == "daily" else (WD[d.weekday()] in r["byday"] and (off // 7) % r["interval"] == 0)
            if hit:
                n += 1
                if r.get("count") and n > r["count"]: break
                if d.isoformat() not in r.get("exdates", []):
                    s0 = wall_to_ms(z, d, w.hour * 60 + w.minute, w.second)
                    if s0 + (en - st) > lo and s0 < hi: out.append((s0, s0 + en - st))
            d += dt.timedelta(days=1)
        return out
    rows = jsonl(p); kinds = {}; nwin = 0; first_short = 0; allday_busy_ignored = 0; dst = 0; odd_sec = 0
    for r in rows:
        t = r["id"]; z = ZoneInfo(r["device_tz"]); now = r["now_ms"]; days = r["days"]; kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
        nl = dt.datetime.fromtimestamp(now / 1000, z)
        check(dt.datetime.fromisoformat(r["now"]).timestamp() * 1000 == now, f"{t}: now")
        # range end: same wall-clock time `days` later (JS setDate)
        rl = dt.datetime.fromtimestamp(r["range"]["end_ms"] / 1000, z)
        want_end = nl.replace(tzinfo=None) + dt.timedelta(days=days)
        ok_wall = rl.replace(tzinfo=None) == want_end
        check(ok_wall or abs(r["range"]["end_ms"] - now - days * 86400000) <= 3600000, f"{t}: range end")
        if r["dst_transitions_in_range"]: dst += 1
        listed = sorted((o[0], o[1], e["id"]) for e in r["calendar_events"] for o in occurrences(e, now, r["range"]["end_ms"]))
        check([(x["start_ms"], x["end_ms"], x["event_id"]) for x in sorted(r["listed_events"], key=lambda x: (x["start_ms"], x["end_ms"], x["event_id"]))] == listed, f"{t}: listed_events expansion")
        for x in r["listed_events"]:
            check(dt.datetime.fromisoformat(x["startDate"].replace("Z", "+00:00")).timestamp() * 1000 == x["start_ms"], f"{t}: startDate")
        granted = r["calendar_access"] == "granted"
        busy = sorted((x["start_ms"], x["end_ms"]) for x in r["listed_events"] if not x["allDay"] and x["availability"] != "free") if granted else []
        if granted and any(x["allDay"] and x["availability"] != "free" for x in r["listed_events"]) and r["expected"]["windows"]: allday_busy_ignored += 1
        merged = []
        for b in busy:
            if merged and b[0] <= merged[-1][1]: merged[-1][1] = max(merged[-1][1], b[1])
            else: merged.append([b[0], b[1]])
        q = 15 * M; rq = -(-now // q) * q; want = []
        for d in range(days):
            day = nl.date() + dt.timedelta(days=d)
            for meal, a, b in MW:
                ws, we = wall_to_ms(z, day, a), wall_to_ms(z, day, b); frm = max(ws, rq)
                if we - frm < MINM * M: continue
                if not granted: want.append((frm, frm + min(FB, (min(we, frm + FB * M) - frm) // M) * M, meal)); continue
                # free pieces of [frm, we] minus union(busy); take the first piece >= MIN minutes
                cur = frm; pieces = []
                for s1, e1 in merged:
                    if e1 <= cur: continue
                    if s1 >= we: break
                    if s1 > cur: pieces.append((cur, min(s1, we)))
                    cur = max(cur, e1)
                if cur < we: pieces.append((cur, we))
                good = [pc for pc in pieces if pc[1] - pc[0] >= MINM * M]
                if good:
                    g = good[0]; want.append((g[0], g[0] + min(MAXM, (g[1] - g[0]) // M) * M, meal))
                    if g[1] - g[0] < 30 * M and any(pc[1] - pc[0] >= 60 * M for pc in good[1:]): first_short += 1
        got = [(w["start_ms"], w["end_ms"], w["meal"]) for w in r["expected"]["windows"]]
        check(got == want, f"{t}: windows differ from invariant recomputation")
        for w in r["expected"]["windows"]:
            nwin += 1
            check(MINM <= w["minutes"] <= MAXM and w["end_ms"] - w["start_ms"] == w["minutes"] * M and w["start_ms"] >= rq, f"{t}: window bounds")
            check(not any(s1 < w["end_ms"] and e1 > w["start_ms"] for s1, e1 in busy), f"{t}: window overlaps busy")
            lw = dt.datetime.fromtimestamp(w["start_ms"] / 1000, z); check(dt.datetime.fromisoformat(w["start"]).timestamp() * 1000 == w["start_ms"], f"{t}: iso")
            if w["start_ms"] % M: odd_sec += 1
        check(r["expected"]["count"] == len(r["expected"]["windows"]) <= 2 * days, f"{t}: count")
    stats.update(calendar_cases=len(rows), calendar_windows=nwin, calendar_cases_with_dst_transition=dst,
                 calendar_first_gap_short_while_longer_later=first_short, calendar_allday_busy_ignored_cases=allday_busy_ignored,
                 calendar_windows_starting_mid_minute=odd_sec)
    if ts_path():
        out = node("check_calendar_ts.mjs")
        try:
            j = json.loads(out.strip().splitlines()[-1]); check(j.get("mismatch_count") == 0 and j.get("checked") == len(rows), f"TS calendar: {j}")
            stats["calendar_ts_crosscheck"] = j.get("checked")
        except Exception as ex: check(False, f"TS calendar output {out[-300:]} {ex}")

# ---------------------------------------------------------------- 4. unit conversion / pantry normalization
def validate_units():
    p = os.path.join(HERE, "unit_conversion", "cases.jsonl")
    if not os.path.exists(p): return
    # exact definitions, written independently of the generator
    lb = F("0.45359237") * 1000; gal = F(231) * F("16.387064")      # 1 in^3 = 16.387064 mL exactly (2.54 cm)^3
    U = {"g": ("m", F(1)), "kg": ("m", F(1000)), "mg": ("m", F(1, 1000)), "lb": ("m", lb), "oz": ("m", lb / 16), "ml": ("v", F(1)), "l": ("v", F(1000)),
         "gal": ("v", gal), "qt": ("v", gal / 4), "pt": ("v", gal / 8), "cup": ("v", gal / 16), "fl oz": ("v", gal / 128), "tbsp": ("v", gal / 256),
         "tsp": ("v", gal / 768), "ct": ("c", F(1)), "ea": ("c", F(1)), "dozen": ("c", F(12))}
    check(gal == F("3785.411784"), "gallon definition")
    C = json.load(open(os.path.join(HERE, "unit_conversion", "constants.json")))
    for u, (d, f) in U.items(): check(F(C["constants"][u]["base_per_unit"]) == f, f"constant {u}")
    AL = {a: k for k, v in C["aliases"].items() for a in v}
    def half_up(x, n): q = F(1, 10 ** n); y = (abs(x) / q + F(1, 2)).__floor__() * q; return float(y if x >= 0 else -y)
    def chk_val(v, x, t):
        check(F(v["exact"]) == x and v["value"] == half_up(x, 6) and v["stored"] == half_up(x, 2), f"{t}: value {v} != {x}")
    SRC = {x["id"]: x for x in jsonl(os.path.join(L3, "quantity_parsing", "cases.jsonl"))}
    rows = jsonl(p); kinds = {}; zero_after_store = 0; lossy = 0; oz_liquid = 0
    for r in rows:
        t = r["id"]; kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
        check(r.get("category") is None or r["category"] in CATS, f"{t}: category")
        if r["kind"] == "convert":
            u = AL[r["input"]["raw_unit"]]; check(u == r["unit"], f"{t}: alias"); q = F(str(r["input"]["quantity"]))
            x = q * U[u][1] / U[r["target_unit"]][1]; chk_val(r["result"], x, t)
            back = F(str(r["round_trip"]["stored"])) * U[r["target_unit"]][1] / U[u][1]; chk_val(r["round_trip"]["back_to_source"], back, t)
            check(F(r["round_trip"]["loss_exact"]) == abs(back - q), f"{t}: loss")
            if x > 0 and r["result"]["stored"] == 0: zero_after_store += 1
            if back != q: lossy += 1
        elif r["kind"] == "receipt_to_pantry":
            lines = " ".join(r["lines"]); pt = r["pantry"]
            if r["rule"] == "weight":
                m = re.search(r"([\d.]+)\s*(lb|kg)?\s*@\s*\$?[\d.]+\s*/\s*(lb|kg)", lines, re.I); check(m, f"{t}: no weight in text {lines}")
                if m: chk_val(pt["content"], F(m.group(1)) * U[(m.group(2) or m.group(3)).lower()][1], t)
            e = SRC[r["source_case"]]["expected"]; check(SRC[r["source_case"]]["lines"] == r["lines"], f"{t}: lines")
            q = F(str(e["quantity"])); base = {"m": "g", "v": "ml", "c": None}
            if r["rule"] == "pack_with_size":
                pk = e["pack"]; chk_val(pt["count"], q * pk["count"], t); chk_val(pt["content"], q * pk["count"] * F(str(pk["size"])) * U[pk["size_unit"]][1], t)
                check(pt["content_unit"] == base[U[pk["size_unit"]][0]], t)
            if r["rule"] == "pack_of_counts": chk_val(pt["count"], q * e["pack"]["count"] * F(str(e["pack"]["size"])), t)
            if r["rule"] == "pack_count_only": chk_val(pt["count"], q * e["pack"]["count"], t)
            if r["rule"] == "size_in_name":
                sz = e["size"]; chk_val(pt["content"], q * F(str(sz["value"])) * U[sz["unit"]][1], t); check(pt["content_unit"] == base[U[sz["unit"]][0]], t)
            if r["rule"] == "size_count": chk_val(pt["count"], q * F(str(e["size"]["value"])) * U[e["size"]["unit"]][1], t)
            if r["rule"] == "count": chk_val(pt["count"], q, t)
            check(r["app_quantity"] == e["app_quantity"] and r["app_unit"] == e["app_unit"], f"{t}: app fields")
            if r.get("warnings"): oz_liquid += 1
        elif r["kind"] == "merge":
            e, i = r["existing"], r["incoming"]; check(AL[i["raw_unit"]] == i["unit"], f"{t}: alias")
            if U[e["unit"]][0] != U[i["unit"]][0]: check(r["status"] == "incompatible_dimension" and r["result"] is None, f"{t}: should be incompatible")
            else:
                b = F(str(e["quantity"])) * U[e["unit"]][1] + F(str(i["quantity"])) * U[i["unit"]][1]
                chk_val(r["result"]["base"], b, t); chk_val(r["result"], b / U[e["unit"]][1], t); check(r["result"]["unit"] == e["unit"], t)
        else:
            raw = r["input"]["raw_unit"]
            if r["status"] == "unknown_unit": check(raw not in AL, f"{t}: alias exists")
            elif r["status"] == "invalid_quantity": check(r["input"]["quantity"] <= 0, t)
            else: check(U[AL[raw]][0] != U[r["target_unit"]][0], f"{t}: dims compatible")
    stats.update(unit_cases=len(rows), unit_kinds=kinds, unit_stored_rounds_to_zero=zero_after_store, unit_round_trip_lossy=lossy, unit_oz_on_liquid_warnings=oz_liquid)

# ---------------------------------------------------------------- 5. multi-receipt dedup, returns, split bills
def validate_household():
    p = os.path.join(HERE, "household", "cases.jsonl")
    if not os.path.exists(p): return
    from collections import Counter
    C = D("0.01"); M = lambda x: D(str(x)).quantize(C, rounding=ROUND_HALF_UP)
    ch = lambda s: re.sub(r"[^a-z]", "", s.lower())
    src = {r["id"]: r for r in jsonl(os.path.join(FIX, "large", "receipts", "expected_clean.jsonl"))}
    def sale_names(r): return Counter(i["name"] for i in r["items"] if i["line_type"] == "sale")
    def is_dup(a, b):
        if ch(a["store"]) != ch(b["store"]) or a["purchased_at"] != b["purchased_at"] or M(a["total"]) != M(b["total"]): return False
        for k in ("transaction_id", "time"):
            if a[k] and b[k] and a[k] != b[k]: return False
        A, B = sale_names(a), sale_names(b); u = sum((A | B).values())
        return (sum((A & B).values()) / u if u else 1.0) >= 0.6 or not (A - B) or not (B - A)
    def split_cents(total, w):  # independent largest remainder: floor shares, then +1 to largest remainders (ties: lower index)
        tw = sum(w) or len(w); w = w if sum(w) else [1] * len(w)
        if total < 0: return [-x for x in split_cents(-total, w)]
        sh = [total * x // tw for x in w]; rem = sorted(range(len(w)), key=lambda i: (-(total * w[i] % tw), i))
        for i in rem[:total - sum(sh)]: sh[i] += 1
        return sh
    rows = jsonl(p); kinds = {}; collide = 0; dups = 0
    for r in rows:
        t = r["id"]; kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1; ex = r["expected"]; rs = r["receipts"]
        for rc in rs:
            check(M(sum(M(i["price"]) for i in rc["items"]) + M(rc["tax"])) == M(rc["total"]) or r["kind"] in ("duplicate_scan", "partial_rescan"), f"{t}: receipt arithmetic")
        if r["kind"] in ("duplicate_scan", "partial_rescan", "same_day_other_trip", "app_key_collision"):
            d = is_dup(rs[0], rs[1]); check(bool(ex["duplicates"]) == d, f"{t}: duplicate verdict")
            check(d == (r["kind"] in ("duplicate_scan", "partial_rescan")), f"{t}: kind/verdict")
            dups += d
            ac = ch(rs[0]["store"]) == ch(rs[1]["store"]) and rs[0]["purchased_at"] == rs[1]["purchased_at"] and M(rs[0]["total"]) == M(rs[1]["total"])
            check(ex["app_key_collision"] == ac, f"{t}: collision flag"); collide += ac and not d
            keep = [0] if d else [0, 1]
            check(M(ex["budget_total"]) == sum(M(rs[i]["total"]) for i in keep), f"{t}: budget")
            check([(l["receipt"], l["line"]) for l in ex["pantry_lots"]] == [(i, it["line"]) for i in keep for it in rs[i]["items"] if it["line_type"] == "sale"], f"{t}: pantry lots")
            s0 = src[r["source_receipts"][0]]; check(any(M(x["total"]) == M(s0["total"]) for x in rs), f"{t}: source total")
        elif r["kind"] == "return_reference":
            ret = rs[ex["return_receipt"]]; others = [x for i, x in enumerate(rs) if i != ex["return_receipt"]]; rate = D(str(ret["tax_rate"]))
            tot = D(0); acc = True
            for el in ex["lines"]:
                rl = ret["items"][el["return_line"]]; rq = -rl["quantity"]; amt = -M(rl["price"])
                cand = None
                for o in others:
                    if ch(o["store"]) != ch(ret["store"]): continue
                    if ret["original_transaction_ref"] and o["transaction_id"] != ret["original_transaction_ref"]: continue
                    days = (dt.date.fromisoformat(ret["purchased_at"]) - dt.date.fromisoformat(o["purchased_at"])).days
                    if not 0 <= days <= 90: continue
                    cs = [it for it in o["items"] if it["line_type"] == "sale" and it["name"] == rl["name"] and it["unit"] == rl["unit"] and it["price"] > 0
                          and abs(M(it["price"]) / D(str(it["quantity"])) - amt / D(str(rq))) <= D("0.01")]
                    if cs: cand = next((c for c in cs if c["quantity"] == rq), None) or next((c for c in cs if c["quantity"] >= rq), None) or cs[0]; break
                if el["status"] == "unmatched": check(cand is None, f"{t}: unmatched line actually matches"); acc = False; continue
                check(cand is not None and cand["line"] == el["matched_line"], f"{t}: return match")
                if cand is None: continue
                over = rq > cand["quantity"]; check((el["status"] == "rejected_over_return") == over, f"{t}: over-return")
                if over: acc = False; check(el["refund"] == 0 and el["pantry"] is None, t); continue
                tx = M(amt * rate) if rl["taxable"] else D(0)
                check(M(el["refund"]) == amt and M(el["refund_tax"]) == tx, f"{t}: refund")
                check(el["pantry"]["quantity_delta"] == -rq and el["pantry"]["removes_lot"] == (rq == cand["quantity"]), f"{t}: pantry delta")
                tot += amt + tx
            check(M(ex["refund_total"]) == tot and ex["all_accepted"] == acc, f"{t}: refund total")
        else:
            rc = rs[0]; members = r["household"]; tc = int(M(rc["total"]) * 100); got = [int(M(ex["per_member"][x]) * 100) for x in members]
            check(sum(got) == tc, f"{t}: split sum")
            if r["mode"] == "even": check(got == split_cents(tc, [1] * len(members)), f"{t}: even split")
            elif r["mode"] == "percent": check(got == split_cents(tc, [r["assignment"]["percent"][x] for x in members]), f"{t}: percent split")
            else:
                own = r["assignment"]["line_owner"]; per = [0] * len(members); txb = [0] * len(members)
                for it in rc["items"]:
                    o = own[str(it["line"])]; c = int(M(it["price"]) * 100)
                    if it["line_type"] == "discount" and it.get("applies_to"):
                        tg = next((x for x in rc["items"] if x["line_type"] == "sale" and x["raw_name"] == it["applies_to"]), None)
                        check(o == (own[str(tg["line"])] if tg else "shared"), f"{t}: discount owner")
                    sh = split_cents(c, [1] * len(members)) if o == "shared" else [c if x == o else 0 for x in members]
                    for i, v in enumerate(sh):
                        per[i] += v; txb[i] += v if it["taxable"] else 0
                tx = split_cents(int(M(rc["tax"]) * 100), [max(v, 0) for v in txb])
                check(got == [a + b for a, b in zip(per, tx)], f"{t}: by-item split")
    stats.update(household_cases=len(rows), household_kinds=kinds, household_duplicates=dups, household_app_key_collisions_not_duplicates=collide)

# ---------------------------------------------------------------- 6. JSON-schema conformance: large3 schemas (all earlier sets) + large4 schemas
TYPES = {"string": lambda v: isinstance(v, str), "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
         "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool), "boolean": lambda v: isinstance(v, bool),
         "null": lambda v: v is None, "array": lambda v: isinstance(v, list), "object": lambda v: isinstance(v, dict)}
def sv(v, sch, path, errs):
    """JSON Schema subset validator: type, enum, pattern, properties, required, additionalProperties, items."""
    if len(errs) > 5: return
    ts = sch.get("type"); ts = [ts] if isinstance(ts, str) else ts
    if ts and not any(TYPES[t](v) for t in ts): errs.append(f"{path}: type {type(v).__name__} not in {ts}"); return
    if "enum" in sch and v not in sch["enum"]: errs.append(f"{path}: {v!r} not in enum"); return
    if isinstance(v, str) and "pattern" in sch and not re.search(sch["pattern"], v): errs.append(f"{path}: {v!r} !~ {sch['pattern']}")
    if isinstance(v, dict):
        for k in sch.get("required", []):
            if k not in v: errs.append(f"{path}: missing {k}")
        props = sch.get("properties", {}); ap = sch.get("additionalProperties", True)
        for k, x in v.items():
            if k in props: sv(x, props[k], f"{path}.{k}", errs)
            elif ap is False: errs.append(f"{path}: unexpected key {k}")
            elif isinstance(ap, dict): sv(x, ap, f"{path}.{k}", errs)
    if isinstance(v, list) and "items" in sch:
        for i, x in enumerate(v): sv(x, sch["items"], f"{path}[{i}]", errs)

def run_manifest(sd, tag):
    man = json.load(open(os.path.join(sd, "manifest.json"))); n = 0
    for mf in man["sets"]:
        sch = json.load(open(os.path.join(sd, mf["schema"])))
        check(sch.get("$schema", "").startswith("https://json-schema.org/"), f"{mf['schema']}: $schema")
        files = sorted(p for g in mf["files"] for p in glob.glob(os.path.join(FIX, g))); check(files, f"{mf['schema']}: no files"); cnt = 0
        for p in files:
            for i, r in enumerate(jsonl(p) if mf["jsonl"] else [json.load(open(p, encoding="utf-8"))]):
                errs = []; sv(r, sch, f"{os.path.relpath(p, FIX)}#{i}", errs); cnt += 1; check(not errs, "; ".join(errs[:3]))
        check(cnt == mf["records"], f"{tag} {mf['schema']}: {cnt} records != manifest {mf['records']}"); n += cnt
    return man, len(man["sets"]), n

def validate_schemas():
    sd4 = os.path.join(HERE, "schemas")
    if not os.path.exists(os.path.join(sd4, "manifest.json")): return
    _, s3, n3 = run_manifest(os.path.join(L3, "schemas"), "large3")
    man4, s4, n4 = run_manifest(sd4, "large4")
    na = 0
    for a in man4["large3_schemas_applied"]:          # large3 sub-schema reused on large4 records with the same shape
        sch = json.load(open(os.path.normpath(os.path.join(sd4, a["schema"]))))
        for part in a["pointer"].split("/"): sch = sch[part]
        for p in sorted(q for g in a["files"] for q in glob.glob(os.path.join(FIX, g))):
            for r in jsonl(p):
                node = r
                keys = a["record_path"].split("/")
                for k in keys[:-1]: node = node[k]
                for i, it in enumerate(node if keys[-1] == "*" else [node[keys[-1]]]):
                    errs = []; sv(it, sch, f"{r['id']}.{a['record_path']}[{i}]", errs); na += 1; check(not errs, "; ".join(errs[:3]))
    stats.update(schema_sets_large3=s3, schema_records_large3=n3, schema_sets_large4=s4, schema_records_large4=n4, schema_large3_subschema_records_on_large4=na)

VALIDATORS = [validate_allergen_regression, validate_ocr, validate_calendar, validate_units, validate_household, validate_schemas]

if __name__ == "__main__":
    for v in VALIDATORS: v()
    stats["total_bytes"] = TOTAL
    print(("OK " if not errors else "FAIL ") + json.dumps(stats, ensure_ascii=False))
    for e in errors[:60]: print(e)
    sys.exit(1 if errors else 0)
