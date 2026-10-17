#!/usr/bin/env python3
"""Validate fixtures/large: JSON/JSONL validity, receipt arithmetic (independent re-parse of every clean .txt),
ocr_noise <-> clean consistency, pantry expiry recomputation from ../shelf_life.json, allergen label recomputation
via the documented matcher, planner derived fields. Run: python3 fixtures/large/validate.py [--quick]"""
import json, os, re, sys, glob, datetime as dt
from decimal import Decimal as D, ROUND_HALF_UP
HERE = os.path.dirname(os.path.abspath(__file__)); FIX = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(HERE, "_gen"))
errors, stats = [], {}
def check(c, m):
    if not c and len(errors) < 200: errors.append(m)
    if not c: stats["errors_total"] = stats.get("errors_total", 0) + 1

def jsonl(path):
    out = []
    for n, line in enumerate(open(path), 1):
        try: out.append(json.loads(line))
        except Exception as e: check(False, f"{path}:{n} invalid JSON: {e}")
    return out

shelf = json.load(open(os.path.join(FIX, "shelf_life.json")))
CATS = {c["category"]: c for c in shelf["categories"]}
VALID = set(CATS) | {"non_food", "discount", "deposit", "fee"}

# every .json / .jsonl parses
for p in glob.glob(os.path.join(HERE, "**", "*.json"), recursive=True): 
    try: json.load(open(p))
    except Exception as e: check(False, f"{p}: {e}")
for p in glob.glob(os.path.join(HERE, "**", "*.jsonl"), recursive=True): jsonl(p)
# file size limit
for p in glob.glob(os.path.join(HERE, "**", "*"), recursive=True):
    if os.path.isfile(p): check(os.path.getsize(p) < 50 * 1024 * 1024, f"{p} >= 50MB")

# ---------------------------------------------------------------- receipts
AMT = re.compile(r"^(?P<desc>\S.*?)\s{2,}(?P<amt>\d+\.\d{2})(?P<neg>-)?(?:\s(?P<flag>[A-Z]))?\s*$")
TEND = re.compile(r"^(?P<t>[A-Z ]+?) TEND\s{2,}(?P<amt>\d+\.\d{2})(?P<neg>-)?\s*$")
def amt(m): return D(m["amt"]) * (-1 if m["neg"] else 1)
def parse_receipt(text):
    lines = text.split("\n")
    i = lines.index("")  # header ends at first blank line
    legend = [l for l in lines if "=TAXABLE" in l][0]; tflag = legend.split("=")[0].strip()
    items, voids, pending, got, tenders = [], [], None, {}, []
    j = i + 1
    while j < len(lines) and not lines[j].startswith("SUBTOTAL"):
        l = lines[j]; j += 1
        if not l.strip() or l[0] == " ": pending = None; continue
        m = AMT.match(l)
        if not m:
            pending = l.strip(); continue
        desc = m["desc"].strip()
        if desc.startswith("TOTAL COUPONS"): pending = None; continue
        if desc.startswith("** VOID **"):
            for k in range(len(items) - 1, -1, -1):
                if items[k][1] == -amt(m):
                    voids.append(items.pop(k)); break
            pending = None; continue
        if pending: desc = pending + " " + desc; pending = None
        items.append((desc, amt(m), m["flag"] == tflag))
    for l in lines[j:]:
        m = TEND.match(l)
        if m: tenders.append(amt(m)); continue
        m = AMT.match(l)
        if not m: continue
        d = m["desc"].strip()
        if d.startswith("SUBTOTAL"): got["subtotal"] = amt(m)
        elif d.startswith("TAX"): got["tax"] = amt(m)
        elif d in ("TOTAL", "**** TOTAL"): got["total"] = amt(m)
        elif d == "CHANGE": got["change"] = amt(m)
    date = next((l[:8] for l in lines[j:] if re.match(r"^\d\d/\d\d/\d\d ", l)), None)
    return items, voids, got, tenders, date

def validate_receipts():
    root = os.path.join(HERE, "receipts")
    if not os.path.isdir(root): return
    clean = jsonl(os.path.join(root, "expected_clean.jsonl"))
    noise = jsonl(os.path.join(root, "expected_ocr_noise.jsonl"))
    files = set(os.path.relpath(p, root) for p in glob.glob(os.path.join(root, "*", "*", "*.txt")))
    check(files == {e["file"] for e in clean} | {e["file"] for e in noise}, "receipt files != expected entries")
    stores = set()
    for e in clean:
        txt = open(os.path.join(root, e["file"])).read()
        items, voids, got, tenders, date = parse_receipt(txt)
        rate = D(str(e["tax_rate"]))
        sub = sum((x[1] for x in items), D(0)); base = sum((x[1] for x in items if x[2]), D(0))
        tax = (base * rate).quantize(D("0.01"), rounding=ROUND_HALF_UP)
        f = e["file"]
        check(sub == got.get("subtotal"), f"{f}: line sum {sub} != printed subtotal {got.get('subtotal')}")
        check(tax == got.get("tax"), f"{f}: tax {tax} != printed {got.get('tax')}")
        check(sub + tax == got.get("total"), f"{f}: subtotal+tax != total")
        check(sum(tenders, D(0)) - got.get("change", D(0)) == got.get("total"), f"{f}: tenders - change != total")
        check(D(str(e["subtotal"])) == sub and D(str(e["tax"])) == tax and D(str(e["total"])) == sub + tax, f"{f}: expected totals mismatch")
        check([(x[0], x[1], x[2]) for x in items] == [(i["raw_text"], D(str(i["price"])), i["taxable"]) for i in e["items"]], f"{f}: items mismatch")
        check(len(voids) == len(e["voided_lines"]), f"{f}: void count")
        check(date == dt.date.fromisoformat(e["date"]).strftime("%m/%d/%y"), f"{f}: date")
        check(all(i["category"] in VALID for i in e["items"]), f"{f}: bad category")
        check(all(i["observed"] is False for i in e["items"]), f"{f}: observed must be false")
        stores.add(e["store"])
    check(len(stores) == 7, "not all 7 stores in receipts")
    byid = {e["id"]: e for e in clean}
    for e in noise:
        c = byid.get(e["clean_ref"])
        check(c is not None, f"{e['id']}: bad clean_ref")
        if not c: continue
        check(e["items"] == c["items"] and e["total"] == c["total"], f"{e['id']}: ground truth differs from clean")
        nt = open(os.path.join(root, e["file"])).read(); ct = open(os.path.join(root, c["file"])).read()
        check(nt.count("\n") == ct.count("\n"), f"{e['id']}: line count differs")
        check(nt != ct or not e["noise_ops"], f"{e['id']}: noise ops but identical text")
    stats["receipts_clean"] = len(clean); stats["receipts_ocr_noise"] = len(noise)

def validate_lines():
    files = sorted(glob.glob(os.path.join(HERE, "receipt_lines", "*.jsonl")))
    if not files: return
    n = 0; stores = set(); ids = set()
    for p in files:
        for r in jsonl(p):
            n += 1; stores.add(r["store"])
            for k in ("id", "store", "raw_text", "normalized_name", "quantity", "unit", "price", "category", "observed", "line_type"):
                check(k in r, f"line {r.get('id')}: missing {k}")
            check(r["category"] in VALID, f"line {r['id']}: bad category {r['category']}")
            check(r["observed"] is False, f"line {r['id']}: observed must be false")
            check(r["id"] not in ids, f"dup id {r['id']}"); ids.add(r["id"])
            if r["line_type"] in ("discount", "return", "void"): check(r["price"] <= 0, f"line {r['id']}: {r['line_type']} must be <= 0")
            if r["line_type"] in ("weight_detail",): check(money(D(str(r["quantity"])) * D(str(r["unit_price"]))) == money(r["price"]), f"line {r['id']}: weight math")
    check(n >= 20000, f"only {n} receipt lines"); check(len(stores) == 7, "lines: not all stores")
    stats["receipt_lines"] = n

def validate_pantry():
    p = os.path.join(HERE, "pantry", "expiry_cases.jsonl")
    if not os.path.exists(p): return
    rows = jsonl(p); ex = {e["item"]: e["category"] for e in shelf["examples"]}
    for r in rows:
        c = CATS.get(r["expected_category"]); check(c is not None, f"{r['id']}: unknown category")
        if not c: continue
        check(ex.get(r["item"]) == r["expected_category"], f"{r['id']}: item->category disagrees with shelf_life examples")
        st = r["requested_storage"] or c["default_storage"]; check(st == r["expected_storage"], f"{r['id']}: storage")
        days = c[f"{st}_days"]; check(days == r["shelf_life_days"], f"{r['id']}: days")
        want = None if days is None else (dt.date.fromisoformat(r["purchase_date"]) + dt.timedelta(days=days)).isoformat()
        check(want == r["expected_expiry_date"], f"{r['id']}: expiry {r['expected_expiry_date']} != {want}")
    stats["pantry_cases"] = len(rows)

def validate_allergens():
    p = os.path.join(HERE, "allergens", "cases.jsonl")
    if not os.path.exists(p): return
    sys.path.insert(0, os.path.join(HERE, "_gen"))
    from allergen_matcher import analyze
    rows = jsonl(p); kinds = {}
    for r in rows:
        a = analyze(r["product_name"], r["ingredients"]); kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
        for k in ("contains", "may_contain", "app_keys", "fda_excluded_tree_nuts", "mollusks", "cross_reactive"):
            check(a[k] == r["expected_" + k], f"{r['id']}: {k} {r['expected_' + k]} != matcher {a[k]}")
        check(not set(a["contains"]) & set(a["may_contain"]), f"{r['id']}: contains/may overlap")
        check("coconut" not in str(a["contains"]), f"{r['id']}: coconut")
    stats["allergen_cases"] = len(rows); stats["allergen_kinds"] = kinds

def validate_planner():
    p = os.path.join(HERE, "planner", "scenarios.jsonl")
    if not os.path.exists(p): return
    from planner_logic import free_windows, busy_blocks, days_until
    from allergen_matcher import analyze
    rows = jsonl(p); nwin = 0
    for r in rows:
        d = r["derived"]; sid = r["id"]
        for it in r["pantry"]:
            c = CATS[it["shelf_life_category"]]; days = c[f"{it['storage']}_days"]
            want = None if days is None else (dt.date.fromisoformat(it["purchase_date"]) + dt.timedelta(days=days)).isoformat()
            check(want == it["estimated_expiry"], f"{sid}/{it['id']}: expiry")
            check(it["category"] == c.get("app_category_key"), f"{sid}/{it['id']}: app category")
            keys = set(analyze(it["name"])["app_keys"]); keys |= {"gluten"} if "wheat" in keys else set()
            check(sorted(keys) == it["name_allergen_keys"], f"{sid}/{it['id']}: allergen keys")
        al = set(r["profile"]["allergies"])
        check(d["excluded_item_ids"] == [i["id"] for i in r["pantry"] if set(i["name_allergen_keys"]) & al], f"{sid}: excluded")
        ex = [i for i in r["pantry"] if i["estimated_expiry"]]
        check(d["expired_item_ids"] == [i["id"] for i in ex if days_until(i["estimated_expiry"], r["now"]) < 0], f"{sid}: expired")
        for n, ids in d["expiring_within_days"].items():
            check(ids == [i["id"] for i in ex if 0 <= days_until(i["estimated_expiry"], r["now"]) <= int(n)], f"{sid}: expiring {n}")
        pr = r["profile"]; check(d["macro_kcal_from_targets"] == 4 * pr["protein_target_g"] + 4 * pr["carbs_target_g"] + 9 * pr["fat_target_g"], f"{sid}: kcal")
        w = free_windows(r["now"], r["days"], r["calendar_events"], r["has_calendar_access"])
        check(w == d["expected_free_windows"], f"{sid}: free windows")
        busy = busy_blocks(r["calendar_events"], r["has_calendar_access"]); now = dt.datetime.fromisoformat(r["now"])
        for x in w:  # independent invariants
            s0, e0 = dt.datetime.fromisoformat(x["start"]), dt.datetime.fromisoformat(x["end"])
            lo, hi = ((11, 30), (14, 0)) if x["meal"] == "lunch" else ((17, 30), (21, 0))
            check(dt.time(*lo) <= s0.time() and e0.time() <= dt.time(*hi) and s0 >= now, f"{sid}: window outside meal/now")
            check(20 <= x["minutes"] <= 60 and (e0 - s0).total_seconds() == x["minutes"] * 60, f"{sid}: minutes")
            check(not any(b0 < e0 and s0 < b1 for b0, b1 in busy), f"{sid}: window overlaps busy block")
            if not r["has_calendar_access"]: check(x["minutes"] <= 40, f"{sid}: fallback >40")
        nwin += len(w)
    stats["planner_scenarios"] = len(rows); stats["planner_free_windows"] = nwin

def money(x): return D(str(x)).quantize(D("0.01"), rounding=ROUND_HALF_UP)

validate_receipts()
validate_lines()
for fn in [f for f in list(globals()) if f.startswith("validate_") and f not in ("validate_receipts", "validate_lines")]:
    globals()[fn]()
total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(HERE) if "__pycache__" not in dp for f in fs)
check(total < 300 * 1024 * 1024, f"fixtures/large is {total} bytes (>300MB)")
stats["total_bytes"] = total
if errors:
    print("FAIL", stats); print("\n".join(errors[:60])); sys.exit(1)
print("OK", json.dumps(stats))
