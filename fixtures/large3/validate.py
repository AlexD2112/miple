#!/usr/bin/env python3
"""Validate fixtures/large3 (and JSON-schema conformance of every fixture set in fixtures/, large, large2, large3).
Labels are recomputed from ../shelf_life.json, ../allergens.json and the app code. Optional: set TS_PATH to a TypeScript
install (node_modules/typescript) to cross-check app verdicts against the REAL server/src/domain/allergens.ts via node.
Run: python3 fixtures/large3/validate.py"""
import json, os, re, sys, glob, subprocess, datetime as dt
from decimal import Decimal as D, ROUND_HALF_UP
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__)); FIX = os.path.dirname(HERE); REPO = os.path.dirname(FIX)
sys.path.insert(0, os.path.join(HERE, "_gen"))
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
shelf = json.load(open(os.path.join(FIX, "shelf_life.json")))
CATS = {c["category"]: c for c in shelf["categories"]}
for p in glob.glob(os.path.join(HERE, "**", "*.json"), recursive=True):
    try: json.load(open(p, encoding="utf-8"))
    except Exception as e: check(False, f"{p}: {e}")
for p in glob.glob(os.path.join(HERE, "**", "*.jsonl"), recursive=True): jsonl(p)
TOTAL = 0
for dp, _, fs in os.walk(HERE):
    if "__pycache__" in dp or "node_modules" in dp: continue
    for f in fs:
        s = os.path.getsize(os.path.join(dp, f)); TOTAL += s; check(s < 50 * 1024 * 1024, f"{dp}/{f} >= 50MB")
        check(not f.endswith(".pyc"), f"{dp}/{f}: pyc")
check(TOTAL < 150 * 1024 * 1024, f"total {TOTAL} >= 150MB")

# ---------------------------------------------------------------- 1. LLM safety
def validate_llm_safety():
    p = os.path.join(HERE, "llm_safety", "cases.jsonl")
    if not os.path.exists(p): return
    from app_allergens import find_allergens, violates, KEYWORDS
    sys.path.insert(0, os.path.join(FIX, "large", "_gen")); from allergen_matcher import analyze
    T = json.load(open(os.path.join(HERE, "llm_safety", "lookup_tables.json"), encoding="utf-8")); EXP = T["expansions"]
    GL = [w for w in KEYWORDS["gluten"] if w not in KEYWORDS["wheat"]]
    MAY = {"tree nuts": "tree_nut", "peanuts": "peanut", "eggs": "egg", "crustacean shellfish": "shellfish"}
    def ref(c, seen=()):
        comps = EXP.get(c.lower()); cont, may = set(), set()
        for x in (comps if comps else [c]):
            if comps and x.lower() in EXP and x.lower() not in seen:
                a, b = ref(x, seen + (c.lower(),)); cont |= a; may |= b; continue
            a = analyze(x); ks = set(a["app_keys"]) | ({"shellfish"} if a["mollusks"] else set())
            if "wheat" in ks or any(re.search(r"\b" + w + r"\b", x.lower()) for w in GL): ks.add("gluten")
            mk = {MAY.get(y, y) for y in a["may_contain"]}; mk |= {"gluten"} if "wheat" in mk else set()
            cont |= ks; may |= mk
        return cont, may
    rows = jsonl(p); kinds = {}; gaps = {}
    for r in rows:
        t = r["id"]; rec = r["recipe"]; prof = r["profile"]["allergies"]; kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
        v, reason = violates(rec, prof)
        hits = find_allergens([rec["title"]] + [i["name"] for i in rec["ingredients"]] + rec["steps"], prof)
        check(v == r["app"]["violates"] and reason == r["app"]["reason"] and hits == r["app"]["hits"], f"{t}: app port mismatch")
        check(r["app_verdict"] == ("reject" if v else "allow"), f"{t}: app verdict")
        cont, may = set(), set()
        for c in r["canonical_ingredients"]: a, b = ref(c); cont |= a; may |= b
        known = [a for a in prof if a in KEYWORDS]; ctext = " \n ".join(r["canonical_ingredients"]).lower()
        unk = [u for u in prof if u not in KEYWORDS and re.search(r"\b" + re.escape(u) + r"(e?s)?\b", ctext)]
        decl = [a for a in prof if a in [d.lower() for d in rec["declared_allergens"]]]
        want = "reject" if (set(known) & cont or unk or decl) else ("caution" if set(known) & (may - cont) else "allow")
        check(want == r["expected_verdict"], f"{t}: reference verdict {r['expected_verdict']} != {want}")
        check(sorted(r["offending"]) == sorted([k for k in known if k in cont] + unk), f"{t}: offending keys")
        check(sorted(cont) == r["present_allergens"], f"{t}: present allergens")
        g = "app_false_negative" if want == "reject" and not v else "app_false_positive" if want == "allow" and v else None
        check(g == r["gap"], f"{t}: gap"); gaps[str(g)] = gaps.get(str(g), 0) + 1
        for k in ("title", "minutes", "servings", "ingredients", "steps", "calories", "protein_g", "carbs_g", "fat_g", "declared_allergens"):
            check(k in rec, f"{t}: RecipeDraft missing {k}")
    ts = os.environ.get("TS_PATH")
    if ts:
        out = subprocess.run(["node", os.path.join(HERE, "_gen", "app_allergens_check.mjs")], input="\n".join(json.dumps(r, ensure_ascii=False) for r in rows),
                             capture_output=True, text=True, check=True).stdout
        got = {j["id"]: j for j in map(json.loads, out.strip().split("\n"))}
        check(all(got[r["id"]]["violates"] == r["app"]["violates"] and got[r["id"]]["hits"] == r["app"]["hits"] for r in rows), "node allergens.ts disagrees")
        stats["llm_safety_node_crosscheck"] = len(got)
    stats["llm_safety_cases"] = len(rows); stats["llm_safety_gaps"] = gaps; stats["llm_safety_kinds"] = kinds

# ---------------------------------------------------------------- 2. pantry sequences (independent replay)
def validate_pantry_sequences():
    files = sorted(glob.glob(os.path.join(HERE, "pantry_sequences", "*.jsonl")))
    if not files: return
    APPD = {k: int(v) for k, v in re.findall(r"\('([a-z_]+)',\s*(\d+)\)", open(os.path.join(REPO, "supabase", "migrations", "0001_init.sql")).read().split("insert into public.shelf_life", 1)[1].split(";", 1)[0])}
    def exp(cat, pd):
        c = CATS[cat]; d = c[c["default_storage"] + "_days"]
        return (pd + dt.timedelta(days=d), "shelf_life.json") if d is not None else (pd + dt.timedelta(days=APPD[c["app_category_key"]]), "app_shelf_life_table")
    n = ncp = 0
    for f in files:
        for r in jsonl(f):
            n += 1; lots = []; used = {}; wasted = {}; cps = {c["day"]: c for c in r["checkpoints"]}; seen_cp = 0
            start = dt.date.fromisoformat(r["start"]); end = dt.date.fromisoformat(r["end"])
            evs = {}
            for e in r["events"]: evs.setdefault(e["day"], []).append(e)
            day = start
            while day <= end:
                for e in evs.get(day.isoformat(), []):
                    if e["type"] in ("receipt", "leftover"):
                        lines = e["lines"] if e["type"] == "receipt" else [e]; agg = {}
                        for l in lines:
                            k = (l["name"], l["unit"])
                            if k in agg: agg[k]["q"] += D(str(l["quantity"]))
                            else: agg[k] = dict(l, q=D(str(l["quantity"])))
                        for l in agg.values():
                            ex, src = exp(l["category"], day)
                            lots.append(dict(id=f"L{len(lots) + 1:03d}", name=l["name"], unit=l["unit"], q=l["q"], pd=day, ex=ex, src=src, st="active"))
                    elif e["type"] == "consume":
                        need = D(str(e["quantity"]))
                        for l in sorted([l for l in lots if l["name"] == e["name"] and l["unit"] == e["unit"] and l["st"] == "active" and l["ex"] >= day], key=lambda l: (l["ex"], l["pd"], l["id"])):
                            if need <= 0: break
                            t = min(need, l["q"]); l["q"] -= t; need -= t; used[l["name"]] = used.get(l["name"], D(0)) + t
                            if l["q"] == 0: l["st"] = "used"
                    elif e["type"] == "discard_expired":
                        for l in lots:
                            if l["st"] == "active" and l["ex"] < day: l["st"] = "wasted"; wasted[l["name"]] = wasted.get(l["name"], D(0)) + l["q"]
                    elif e["type"] == "discard_lot":
                        l = next(l for l in lots if l["id"] == e["lot_id"])
                        if l["st"] == "active": l["st"] = "wasted"; wasted[l["name"]] = wasted.get(l["name"], D(0)) + l["q"]
                cp = cps.get(day.isoformat())
                if cp:
                    seen_cp += 1; ncp += 1
                    act = sorted([l for l in lots if l["st"] == "active"], key=lambda l: (l["name"], l["ex"], l["pd"], l["id"]))
                    check([(l["id"], D(str(l["q"])), l["ex"].isoformat(), l["src"], (l["ex"] - day).days) for l in act] ==
                          [(x["lot_id"], D(str(x["quantity"])), x["estimated_expiry"], x["expiry_source"], x["days_left"]) for x in cp["active_lots"]], f"{r['id']} {day}: active lots")
                    check(cp["expired_active_lot_ids"] == [l["id"] for l in act if l["ex"] < day], f"{r['id']} {day}: expired list")
                    check({k: D(str(v)) for k, v in cp["used_totals"].items()} == used and {k: D(str(v)) for k, v in cp["wasted_totals"].items()} == wasted, f"{r['id']} {day}: used/wasted totals")
                    nxt = {}
                    for l in act:
                        if l["ex"] >= day: nxt.setdefault(f'{l["name"]}|{l["unit"]}', l["id"])
                    check(nxt == cp["next_to_use"], f"{r['id']} {day}: next_to_use")
                day += dt.timedelta(days=1)
            check(seen_cp == len(r["checkpoints"]), f"{r['id']}: checkpoint days")
    stats["pantry_sequences"] = n; stats["pantry_checkpoints"] = ncp

# ---------------------------------------------------------------- 3. quantity parsing (independent text parse)
def validate_quantity():
    p = os.path.join(HERE, "quantity_parsing", "cases.jsonl")
    if not os.path.exists(p): return
    def m2(x): return D(str(x)).quantize(D("0.01"), rounding=ROUND_HALF_UP)
    AMT = re.compile(r"\s{2,}(\d+\.\d{2})(-)?$")
    W = re.compile(r"(\d+\.\d+)\s*(lb|kg)?\s*@\s*\$?(\d+\.\d{2})\s*/\s*(lb|kg)", re.I)
    QA = re.compile(r"^(?:QTY )?(\d+)(?: EA)? (?:@|X) \$?(\d+\.\d{2})")
    DL = re.compile(r"^(\d+) @ (\d+)(?:/| FOR )\$?(\d+\.\d{2})")
    UPC = re.compile(r"^\s+(\d) (\d{5}) (\d{5}) (\d)$")
    rows = jsonl(p); types = {}
    for r in rows:
        t = r["id"]; e = r["expected"]; types[r["pricing_type"]] = types.get(r["pricing_type"], 0) + 1
        pos = sum((D(m[1]) for l in r["lines"] for m in [AMT.search(l)] if m and not m[2]), D(0))
        neg = sum((D(m[1]) for l in r["lines"] for m in [AMT.search(l)] if m and m[2]), D(0))
        check(pos == m2(e["gross_total"]) and neg == m2(e["discount_total"]) and m2(e["line_total"]) == pos - neg, f"{t}: totals from text")
        txt = r["lines"][0]
        if r["pricing_type"] in ("deal_n_for",):
            m = DL.match(txt); q, n, dp = int(m[1]), int(m[2]), D(m[3]); per = m2(dp / n)
            check(m2((q // n) * dp + (q % n) * per) == pos and e["quantity"] == q and m2(e["unit_price"]) == per, f"{t}: deal")
        elif W.search(txt):
            m = W.search(txt); q, pr = D(m[1]), D(m[3])
            check(m2(q * pr) == pos and D(str(e["quantity"])) == q and m2(e["unit_price"]) == pr and e["unit"] == m[4].lower(), f"{t}: weight")
        elif QA.match(txt):
            m = QA.match(txt); q, pr = int(m[1]), D(m[2])
            check(m2(q * pr) == pos and e["quantity"] == q and m2(e["unit_price"]) == pr, f"{t}: qty @")
        if r["pricing_type"] == "upc_embedded":
            m = UPC.match(r["lines"][1]); d = "".join(m.groups())
            chk = (10 - sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(d[:11])) % 10) % 10
            check(d[0] == "2" and int(d[11]) == chk and m2(D(int(d[6:11])) / 100) == pos and e["weight_embedded"]["upc"] == d, f"{t}: upc")
        if r["pricing_type"] == "bogo": check(e["quantity"] == 2 and pos == 2 * m2(e["unit_price"]), f"{t}: bogo")
        if e["size"]: check(e["size"]["unit"] in ("oz", "fl oz", "gal", "ct", "l", "lb", "ea", "ml"), f"{t}: size unit")
        # app ParsedReceipt quantity rule (README)
        q = e["quantity"]
        if e["unit"] in ("lb", "kg"): want = (q, e["unit"])
        elif e["pack"]: want = (q * e["pack"]["count"] * (e["pack"]["size"] if e["pack"]["size_unit"] == "ct" else 1), "ct")
        elif e["size"] and e["size"]["unit"] != "ea": want = (e["size"]["value"] if q == 1 else float(m2(D(str(e["size"]["value"])) * q)), e["size"]["unit"])
        elif q == 1: want = (1, None)
        else: want = (q, "ea")
        check((e["app_quantity"], e["app_unit"]) == want, f"{t}: app quantity {(e['app_quantity'], e['app_unit'])} != {want}")
        check(r["category"] in CATS or r["category"] == "non_food", f"{t}: category")
    stats["quantity_cases"] = len(rows); stats["quantity_types"] = types

# ---------------------------------------------------------------- 4. expiry ranking
def validate_ranking():
    p = os.path.join(HERE, "expiry_ranking", "cases.jsonl")
    if not os.path.exists(p): return
    APPD = {k: int(v) for k, v in re.findall(r"\('([a-z_]+)',\s*(\d+)\)", open(os.path.join(REPO, "supabase", "migrations", "0001_init.sql")).read().split("insert into public.shelf_life", 1)[1].split(";", 1)[0])}
    rows = jsonl(p)
    for r in rows:
        t = r["id"]; today = dt.date.fromisoformat(r["today"]); e = r["expected"]
        act = [i for i in r["pantry"] if i["status"] == "active" and i["quantity"] > 0]
        dl = {i["id"]: (dt.date.fromisoformat(i["estimated_expiry"]) - today).days for i in act if i["estimated_expiry"]}
        k = lambda i: (dl[i["id"]], APPD[i["category"]], i["purchase_date"], i["name"].casefold(), i["id"])
        use = sorted([i for i in act if i["id"] in dl and dl[i["id"]] >= 0], key=k)
        check([x["id"] for x in e["use_first"]] == [i["id"] for i in use], f"{t}: use_first order")
        check(all(x["days_left"] == dl[x["id"]] and x["urgency"] == round(1 / (1 + max(0, x["days_left"])), 6) for x in e["use_first"]), f"{t}: days/urgency")
        check([x["id"] for x in e["expired"]] == [i["id"] for i in sorted([i for i in act if i["id"] in dl and dl[i["id"]] < 0], key=k)], f"{t}: expired")
        check(set(e["unknown_expiry"]) == {i["id"] for i in act if not i["estimated_expiry"]}, f"{t}: unknown")
        check(set(e["excluded"]) == {i["id"] for i in r["pantry"]} - {i["id"] for i in act}, f"{t}: excluded")
        check(e["top3"] == [i["id"] for i in use[:3]], f"{t}: top3")
        check(all(e["expiring_within"][n] == [i["id"] for i in use if dl[i["id"]] <= int(n)] for n in e["expiring_within"]), f"{t}: within")
        check(all(i["category"] in APPD for i in r["pantry"]), f"{t}: app category")
    stats["ranking_cases"] = len(rows); stats["ranking_items"] = sum(len(r["pantry"]) for r in rows)

# ---------------------------------------------------------------- 5. JSON-schema conformance (all fixture sets)
TYPES = {"string": lambda v: isinstance(v, str), "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
         "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool), "boolean": lambda v: isinstance(v, bool),
         "null": lambda v: v is None, "array": lambda v: isinstance(v, list), "object": lambda v: isinstance(v, dict)}
def sv(v, sch, path, errs):
    """Minimal JSON Schema subset validator: type, properties, required, additionalProperties, items, enum, pattern."""
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

def validate_schemas():
    sd = os.path.join(HERE, "schemas"); mf = os.path.join(sd, "manifest.json")
    if not os.path.exists(mf): return
    man = json.load(open(mf)); n = 0; per = {}
    for m in man["sets"]:
        sch = json.load(open(os.path.join(sd, m["schema"])))
        check(sch.get("$schema", "").startswith("https://json-schema.org/"), f"{m['schema']}: $schema")
        files = sorted(p for g in m["files"] for p in glob.glob(os.path.join(FIX, g)))
        check(files, f"{m['schema']}: no files")
        cnt = 0
        for p in files:
            recs = jsonl(p) if m["jsonl"] else [json.load(open(p, encoding="utf-8"))]
            for i, r in enumerate(recs):
                errs = []; sv(r, sch, f"{os.path.relpath(p, FIX)}#{i}", errs); cnt += 1
                check(not errs, "; ".join(errs[:3]))
        check(cnt == m["records"], f"{m['schema']}: record count {cnt} != manifest {m['records']}")
        per[m["schema"].replace(".schema.json", "")] = cnt; n += cnt
    stats["schema_sets"] = len(man["sets"]); stats["schema_records_checked"] = n

VALIDATORS = [validate_llm_safety, validate_pantry_sequences, validate_quantity, validate_ranking, validate_schemas]
if __name__ == "__main__":
    for v in VALIDATORS: v()
    stats["total_bytes"] = TOTAL
    if errors:
        print("FAIL", json.dumps(stats)); print("\n".join(errors[:60])); sys.exit(1)
    print("OK", json.dumps(stats))
