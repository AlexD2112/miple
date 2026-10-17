#!/usr/bin/env python3
"""Validate fixtures/large2. Independent re-parse of receipt text, transform invariants, label recomputation from
../shelf_life.json and ../allergens.json (via the documented batch-1 matcher). Run: python3 fixtures/large2/validate.py"""
import json, os, re, sys, glob, datetime as dt
from decimal import Decimal as D, ROUND_HALF_UP
sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__)); FIX = os.path.dirname(HERE)
errors, stats = [], {}
def check(c, m):
    if not c:
        stats["errors_total"] = stats.get("errors_total", 0) + 1
        if len(errors) < 200: errors.append(m)
def jsonl(path):
    out = []
    for n, line in enumerate(open(path), 1):
        try: out.append(json.loads(line))
        except Exception as e: check(False, f"{path}:{n} invalid JSON: {e}")
    return out
shelf = json.load(open(os.path.join(FIX, "shelf_life.json")))
CATS = {c["category"]: c for c in shelf["categories"]}
VALID = set(CATS) | {"non_food", "discount", "deposit", "fee"}

for p in glob.glob(os.path.join(HERE, "**", "*.json"), recursive=True):
    try: json.load(open(p))
    except Exception as e: check(False, f"{p}: {e}")
for p in glob.glob(os.path.join(HERE, "**", "*.jsonl"), recursive=True): jsonl(p)
TOTAL = 0
for dp, _, fs in os.walk(HERE):
    if "__pycache__" in dp: continue
    for f in fs:
        s = os.path.getsize(os.path.join(dp, f)); TOTAL += s
        check(s < 50 * 1024 * 1024, f"{dp}/{f} >= 50MB")
check(TOTAL < 150 * 1024 * 1024, f"total {TOTAL} >= 150MB")

# ---------------------------------------------------------------- receipt parser (independent of generators)
AMT = re.compile(r"^(?P<desc>\S.*?)\s{2,}(?P<amt>\d+\.\d{2})(?P<neg>-)?(?:\s(?P<flag>[A-Z*]{1,2}))?\s*$")
TEND = re.compile(r"^(?P<t>[A-Z ]+?) TEND\s{2,}(?P<amt>\d+\.\d{2})(?P<neg>-)?\s*$")
def amt(m): return D(m["amt"]) * (-1 if m["neg"] else 1)
def parse_receipt(text):
    lines = text.rstrip("\n").split("\n"); i = lines.index("")
    items, pending, got, tenders = [], None, {}, []
    j = i + 1
    while j < len(lines) and not lines[j].startswith("SUBTOTAL"):
        l = lines[j]; j += 1
        if not l.strip() or l[0] == " ": pending = None; continue
        m = AMT.match(l)
        if not m: pending = l.strip(); continue
        desc = m["desc"].strip()
        if pending: desc = pending + " " + desc; pending = None
        items.append(dict(desc=desc, amt=amt(m), flag=m["flag"] or "", line=j - 1))
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
    return items, got, tenders, date, lines

def Dm(x): return D(str(x))
def check_full_receipt(tag, text, e, store_error=None, check_date=True):
    items, got, tenders, date, lines = parse_receipt(text)
    check([(x["desc"], x["amt"], x["flag"], x["line"]) for x in items] ==
          [(i["raw_text"], Dm(i["price"]), i.get("flag", x_flag(e, i)), i["source_line"]) for i in e["items"]], f"{tag}: items differ from text")
    tf = e["flag_legend"]["taxable"]
    sub = sum((x["amt"] for x in items), D(0)); base = sum((x["amt"] for x in items if x["flag"] == tf), D(0))
    tax = D("0.00") if e["tax_exempt"] else (base * Dm(e["tax_rate"])).quantize(D("0.01"), rounding=ROUND_HALF_UP)
    check(sub == Dm(e["subtotal"]) and base == Dm(e["taxable_base"]) and tax == Dm(e["tax"]) and sub + tax == Dm(e["total"]), f"{tag}: computed totals")
    check(all(bool(i["taxable"]) == (i["flag"] == tf) for i in e["items"]), f"{tag}: taxable vs flag")
    pr = {k: got.get(k) for k in ("subtotal", "tax", "total")}
    check(pr == {k: Dm(v) for k, v in e["printed"].items()}, f"{tag}: printed values {pr} vs {e['printed']}")
    mism = [f for f in ("subtotal", "tax", "total") if pr[f] != Dm(e[f])]
    check(mism == (store_error["mismatched_fields"] if store_error else []), f"{tag}: mismatch flags {mism}")
    check(sum(tenders, D(0)) - got.get("change", D(0)) == pr["total"], f"{tag}: tenders - change != printed total")
    if check_date: check(date == dt.date.fromisoformat(e["date"]).strftime("%m/%d/%y"), f"{tag}: date")
    check(all(i["category"] in VALID and i["observed"] is False for i in e["items"]), f"{tag}: category/observed")
    return items, lines
def x_flag(e, i): return None

def ws(s): return re.sub(r"\s+", " ", s).strip()

def validate_adversarial():
    root = os.path.join(HERE, "adversarial")
    if not os.path.isdir(root): return
    recs = jsonl(os.path.join(root, "expected.jsonl")); cats = {}
    files = set(os.path.relpath(p, root) for p in glob.glob(os.path.join(root, "*", "*", "*.txt")))
    check(files == {r["file"] for r in recs} | {s for r in recs for s in r["source_files"]}, "adversarial files != expected")
    for r in recs:
        c = r["category"]; cats[c] = cats.get(c, 0) + 1; tag = r["id"]
        text = open(os.path.join(root, r["file"])).read(); out = text.rstrip("\n").split("\n")
        srcs = [open(os.path.join(root, s)).read() for s in r["source_files"]]
        check(len(out) == r["text_lines"], f"{tag}: line count")
        if c == "cut_off":
            items, got, tenders, date, sl = parse_receipt(srcs[0]); keep = r["line_ops"][0]["keep_lines"]
            check(out == sl[:keep], f"{tag}: cut text is not a prefix of source")
            e = r["receipts"][0]
            check([(x["desc"], x["amt"]) for x in items if x["line"] < keep] == [(i["raw_text"], Dm(i["price"])) for i in e["items"]], f"{tag}: truncated items")
            check(r["truncated"] and e["total"] is None and e["complete"] is False, f"{tag}: truncated labels")
            continue
        for k, (s, e) in enumerate(zip(srcs, r["receipts"])):
            check_full_receipt(f"{tag}[{k}]", s, e, r["store_error"])
        sl = srcs[0].rstrip("\n").split("\n"); e = r["receipts"][0]
        if c == "columns_misaligned":
            ops = {o["line"] for o in r["line_ops"]}
            check(len(out) == len(sl) and all((ws(a) == ws(b)) if i in ops else (a == b) for i, (a, b) in enumerate(zip(out, sl))), f"{tag}: misalign invariant")
            check(len(ops) > 0, f"{tag}: no ops")
        elif c == "column_split":
            o = r["line_ops"][0]; d0, d1 = o["desc_block"]; a0, a1 = o["amount_block"]
            amts = iter(out[a0:a1]); a = sl.index("") + 1; b = sl.index("", a)
            rebuilt = [x + (" " + next(amts) if AMT.match(sl[a + n]) else "") for n, x in enumerate(out[d0:d1])]
            check([ws(x) for x in rebuilt] == [ws(x) for x in sl[a:b]], f"{tag}: column split invariant")
        elif c == "upside_down": check(out[::-1] == sl, f"{tag}: reversed")
        elif c == "double_scan":
            o = r["line_ops"][0]; n = o["end"] - o["start"]
            check(out[o["copy_start"]:o["copy_start"] + n] == sl[o["start"]:o["end"]], f"{tag}: dup copy")
            rem = out[:o["copy_start"]] + out[o["copy_start"] + n:]
            if o["op"] == "full_duplicate": rem = rem[:-1]
            check(rem == sl and r["duplicated"], f"{tag}: removing duplicate != source")
        elif c == "concatenated":
            o = r["line_ops"][0]; s2 = srcs[1].rstrip("\n").split("\n")
            check(out == sl + o["separator"] + s2 and o["second_starts_at"] == len(sl) + len(o["separator"]), f"{tag}: concat")
            check(len(r["receipts"]) == 2, f"{tag}: needs 2 receipts")
        elif c == "promo_noise":
            check(all(p in out for p in r["ignored_lines"]), f"{tag}: ignored line missing")
            inl = [p for p in r["ignored_lines"] if p.startswith("   ")]
            rem = list(out)
            for p in inl: rem.remove(p)
            check(rem == sl, f"{tag}: removing inline promos != source")
            check(not {i["raw_text"] for i in e["items"]} & set(x.strip() for x in r["ignored_lines"]), f"{tag}: promo parsed as item")
        else: check(out == sl, f"{tag}: text should equal source")
        if c == "legit_repeat":
            its = [(i["raw_text"], i["price"]) for i in e["items"] if i["line_type"] == "sale"]
            check(any(its.count(x) > 1 for x in its) and not r["duplicated"], f"{tag}: legit repeat")
        if c == "very_long": check(sum(i["line_type"] == "sale" for i in e["items"]) >= 150, f"{tag}: <150 items")
        if c == "all_non_food": check(all(i["category"] == "non_food" for i in e["items"] if i["line_type"] == "sale"), f"{tag}: food present")
        if c == "all_return": check(all(i["line_type"] == "return" for i in e["items"]) and e["total"] < 0, f"{tag}: all return")
        if c == "tax_exempt": check(e["tax_exempt"] and e["tax"] == 0 and e["taxable_base"] > 0, f"{tag}: tax exempt")
        if c == "store_error": check(r["store_error"] and r["store_error"]["mismatched_fields"], f"{tag}: store error flag")
    stats["adversarial_receipts"] = len(recs); stats["adversarial_by_category"] = cats

def validate_normalization():
    d = os.path.join(HERE, "normalization")
    if not os.path.isdir(d): return
    EX = {e["item"]: e["category"] for e in shelf["examples"]}
    items = {i["name"]: i for i in jsonl(os.path.join(d, "items.jsonl"))}
    rows = [r for p in sorted(glob.glob(os.path.join(d, "pairs_*.jsonl"))) for r in jsonl(p)]
    seen, by_key, name_cat = set(), {}, {}
    for r in rows:
        t = r["id"]
        check(r["category"] in VALID and r["observed"] is False, f"{t}: category/observed")
        check(r["app_category_key"] == (CATS[r["category"]].get("app_category_key") if r["category"] in CATS else None), f"{t}: app key")
        it = items.get(r["normalized_name"]); check(it is not None and it["category"] == r["category"], f"{t}: item table")
        src = r["label_source"]
        if src == "shelf_life.examples": check(EX.get(r["normalized_name"]) == r["category"], f"{t}: shelf example category")
        if src.startswith("hard_negative:analog="): check(EX.get(src.split("=", 1)[1]) == r["category"] and r["hard_negative"], f"{t}: analog category")
        if r["hard_negative"]: check(r["confusable_with"] in VALID and r["confusable_with"] != r["category"], f"{t}: confusable")
        check((r["store"], r["raw_text"]) not in seen, f"{t}: duplicate"); seen.add((r["store"], r["raw_text"]))
        k = re.sub(r"^\d{4,7} ", "", r["raw_text"]).upper().strip()
        by_key.setdefault(k, set()).add((r["normalized_name"], r["category"]))
        check(name_cat.setdefault(r["normalized_name"], r["category"]) == r["category"], f"{t}: name has 2 categories")
    check(all(len(v) == 1 for v in by_key.values()), "same raw text labeled two ways in pairs")
    check(len(rows) >= 30000, "fewer than 30000 pairs"); check(len({r["store"] for r in rows}) == 7, "stores")
    stats["normalization_pairs"] = len(rows); stats["normalization_hard_negative_rows"] = sum(r["hard_negative"] for r in rows)
    stats["normalization_items"] = len(items)

def validate_e2e():
    d = os.path.join(HERE, "e2e")
    if not os.path.isdir(d): return
    sys.path.insert(0, os.path.join(FIX, "large", "_gen"))
    from allergen_matcher import analyze
    MAYMAP = {"tree nuts": "tree_nut", "peanuts": "peanut", "eggs": "egg", "crustacean shellfish": "shellfish"}
    recs = jsonl(os.path.join(d, "cases.jsonl")); n_p = 0
    for r in recs:
        t = r["id"]; e = r["expected"]; text = open(os.path.join(d, r["file"])).read()
        check_full_receipt(t, text, e["receipt"])
        pd = dt.date.fromisoformat(r["input"]["purchase_date"])
        check(r["input"]["purchase_date"] == e["receipt"]["date"], f"{t}: purchase date")
        want = []
        for idx, i in enumerate(e["receipt"]["items"]):
            if i["line_type"] == "return":
                for w in reversed(want):
                    if w[1] == i["normalized_name"] and not w[2]: w[2] = True; break
                continue
            if i["line_type"] != "sale" or i["category"] not in CATS: continue
            want.append([idx, i["normalized_name"], False])
        want = [w for w in want if not w[2]]
        check([p["item_index"] for p in e["pantry"]] == [w[0] for w in want], f"{t}: pantry membership")
        for p in e["pantry"]:
            c = CATS[p["category"]]; days = c[f"{c['default_storage']}_days"]
            check(p["storage"] == c["default_storage"] and p["shelf_life_days"] == days, f"{t}: storage/days")
            check(p["estimated_expiry"] == (None if days is None else (pd + dt.timedelta(days=days)).isoformat()), f"{t}: expiry")
            a = analyze(p["normalized_name"]); keys = set(a["app_keys"]) | ({"gluten"} if "wheat" in a["app_keys"] else set())
            may = {MAYMAP.get(x, x) for x in a["may_contain"]}; may |= {"gluten"} if "wheat" in may else set()
            check(p["allergen_keys"] == sorted(keys) and p["may_contain_keys"] == sorted(may - keys), f"{t}: allergen keys {p['normalized_name']}")
        for prof in e["profiles"]:
            al = set(prof["allergies"])
            check(prof["flagged_pantry_indexes"] == [k for k, p in enumerate(e["pantry"]) if set(p["allergen_keys"]) & al], f"{t}: flags")
            check(prof["caution_pantry_indexes"] == [k for k, p in enumerate(e["pantry"]) if not set(p["allergen_keys"]) & al and set(p["may_contain_keys"]) & al], f"{t}: caution")
        n_p += len(e["pantry"])
    stats["e2e_cases"] = len(recs); stats["e2e_pantry_entries"] = n_p

MONS = {m: i + 1 for i, m in enumerate(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"])}
def y4(y): y = int(y); return y if y >= 100 else (2000 + y if y < 70 else 1900 + y)   # POSIX %y pivot
DPATS = [(re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b"), lambda m: (int(m[1]), int(m[2]), int(m[3]))),
         (re.compile(r"\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b"), lambda m: (y4(m[3]), int(m[1]), int(m[2]))),   # US month-first
         (re.compile(r"\b(\d{1,2})-([A-Z]{3})-(\d{2})\b"), lambda m: (y4(m[3]), MONS[m[2]], int(m[1]))),
         (re.compile(r"\b([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})\b"), lambda m: (int(m[3]), MONS.get(m[1].upper()), int(m[2])))]
TPAT = re.compile(r"(?<![\d/.-])(\d{1,2}):(\d{2})(?::(\d{2}))?\s?([AaPp][Mm])?")
def parse_stamp(text):
    date = tm = sec = None; biz = None; tz = None
    for l in text.split("\n"):
        if l.startswith("BUSINESS DATE"):
            m = DPATS[1][0].search(l); y, mo, d = DPATS[1][1](m); biz = dt.date(y, mo, d).isoformat(); continue
        if date is None:
            for rx, fn in DPATS:
                m = rx.search(l)
                if m and fn(m)[1]:
                    y, mo, d = fn(m); date = dt.date(y, mo, d).isoformat()
                    rest = l[:m.start()] + " " * (m.end() - m.start()) + l[m.end():]
                    t = TPAT.search(rest)
                    if t:
                        h = int(t[1])
                        if t[4]: h = (h % 12) + (12 if t[4].upper() == "PM" else 0)
                        tm = f"{h:02d}:{t[2]}"; sec = int(t[3]) if t[3] else None
                    z = re.search(r"\b(PDT|PST)\b", rest); tz = z[1] if z else None
                    break
        elif tm is None and l.startswith("TIME:"):
            t = TPAT.search(l); tm = f"{int(t[1]):02d}:{t[2]}"
    return date, tm, sec, biz, tz

def validate_dates():
    d = os.path.join(HERE, "dates")
    if not os.path.isdir(d): return
    cases = jsonl(os.path.join(d, "header_cases.jsonl")); fmts = set()
    for c in cases:
        e = c["expected"]; date, tm, sec, biz, tz = parse_stamp(c["text"])
        check((date, tm, sec, biz, tz) == (e["date"], e["time"], e["seconds"], e["business_date"], e["tz_abbrev"]),
              f"{c['id']} {c['format_id']}: parsed {(date, tm, sec, biz, tz)} != expected")
        check(e["after_midnight"] == (int(e["time"][:2]) < 3), f"{c['id']}: after_midnight")
        if e["tz_abbrev"]:
            from zoneinfo import ZoneInfo
            loc = dt.datetime.fromisoformat(e["date"] + "T" + e["time"]).replace(tzinfo=ZoneInfo("America/Los_Angeles"))
            check(loc.tzname() == e["tz_abbrev"], f"{c['id']}: tz abbrev")
        fmts.add(c["format_id"])
    recs = jsonl(os.path.join(d, "receipts_expected.jsonl"))
    for r in recs:
        text = open(os.path.join(d, r["file"])).read()
        check_full_receipt(r["id"], text, r["receipt"], check_date=False)
        foot = text.split("CHANGE", 1)[1]
        date, tm, sec, biz, tz = parse_stamp(foot)
        check(date == r["date_expected"]["date"] == r["receipt"]["date"] and tm == r["date_expected"]["time"], f"{r['id']}: receipt date/time")
    stats["date_header_cases"] = len(cases); stats["date_formats"] = len(fmts); stats["date_receipts"] = len(recs)

VALIDATORS = [validate_adversarial, validate_normalization, validate_e2e, validate_dates]
if __name__ == "__main__":
    for v in VALIDATORS: v()
    stats["total_bytes"] = TOTAL
    if errors:
        print("FAIL", json.dumps(stats)); print("\n".join(errors[:60])); sys.exit(1)
    print("OK", json.dumps(stats))
