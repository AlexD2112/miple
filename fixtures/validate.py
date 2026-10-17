#!/usr/bin/env python3
"""Validate Miple fixtures: JSON well-formed, category consistency, counts, receipt arithmetic,
and that receipts/expected.json matches what is printed in receipts/*.txt.  Run: python3 fixtures/validate.py"""
import json, re, sys, os, glob
from decimal import Decimal as D, ROUND_HALF_UP
HERE = os.path.dirname(os.path.abspath(__file__))
errors = []
def check(cond, msg):
    if not cond: errors.append(msg)

files = ["shelf_life.json", "receipt_lines.json", "allergens.json", "receipts/expected.json"]
data = {}
for f in files:
    try: data[f] = json.load(open(os.path.join(HERE, f)))
    except Exception as e: errors.append(f"{f}: invalid JSON: {e}")
if errors: print("\n".join(errors)); sys.exit(1)

sl = data["shelf_life.json"]
cats = {c["category"] for c in sl["categories"]}
EXTRA = {"non_food", "discount", "deposit", "fee"}
VALID = cats | EXTRA
for c in sl["categories"]:
    for k in ("category", "fridge_days", "pantry_days", "freezer_days", "default_storage", "source_note"):
        check(k in c, f"shelf_life {c.get('category')}: missing {k}")
    for k in ("fridge_days", "pantry_days", "freezer_days"):
        check(c[k] is None or (isinstance(c[k], int) and c[k] > 0), f"shelf_life {c['category']}.{k} bad")
    check(c["default_storage"] in ("fridge", "pantry", "freezer"), f"{c['category']} storage")
    check(c[c["default_storage"] + "_days"] is not None or c["category"] == "milk", f"{c['category']}: default storage has null days")
for e in sl["examples"]:
    check(e["category"] in cats, f"example {e} bad category")

rl = data["receipt_lines.json"]["lines"]
check(len(rl) >= 150, f"receipt_lines has {len(rl)} < 150")
stores = {"Safeway", "QFC", "Fred Meyer", "Trader Joe's", "Costco", "Whole Foods", "Target"}
check(stores <= {r["store"] for r in rl}, "missing stores in receipt_lines")
for r in rl:
    for k in ("store", "raw_text", "normalized_name", "quantity", "unit", "price", "category", "observed"):
        check(k in r, f"line {r.get('raw_text')}: missing {k}")
    check(r["category"] in VALID, f"line {r['raw_text']}: bad category {r['category']}")
    check(isinstance(r["observed"], bool), f"line {r['raw_text']}: observed not bool")
    if r["observed"]: check(r.get("source_url"), f"observed line {r['raw_text']} lacks source_url")
    if r["category"] == "discount": check(r["price"] is None or r["price"] <= 0, f"discount positive: {r['raw_text']}")

al = data["allergens.json"]["allergens"]
check(len(al) == 9, "allergens != 9")
for a in al:
    check(len(a["terms"]) >= 20 or a.get("fewer_terms_reason"), f"allergen {a['allergen']} has {len(a['terms'])} terms")
    check(len(a["terms"]) == len(set(t.lower() for t in a["terms"])), f"allergen {a['allergen']} duplicate terms")

# receipts
exp = data["receipts/expected.json"]["receipts"]
rate = D(str(data["receipts/expected.json"]["_meta"]["tax_rate"]))
txts = sorted(os.path.basename(p) for p in glob.glob(os.path.join(HERE, "receipts", "*.txt")))
check(len(txts) == 10, f"{len(txts)} receipts, expected 10")
check(set(txts) == set(exp), "expected.json keys != receipt files")
PRICE = re.compile(r"^(?P<desc>.+?)\s{2,}(?P<amt>\d+\.\d{2})(?P<neg>-)?(?:\s(?P<flag>[A-Z]))?\s*$")
SKIP = re.compile(r"^(SUBTOTAL|TAX|\*\*\*\* TOTAL|\*\*\*\* BALANCE|TOTAL|VISA TEND|CHANGE|A \d|TOTAL TAX|TOTAL COUPONS)")
def amt(m): return D(m["amt"]) * (-1 if m["neg"] else 1)
for fn in txts:
    lines = open(os.path.join(HERE, "receipts", fn)).read().splitlines()
    legend = [l for l in lines if "=TAXABLE" in l][0]
    tflag = legend.split("=")[0].strip()
    items, voids, got = [], [], {}
    for l in lines:
        m = PRICE.match(l)
        if not m: continue
        desc = m["desc"].strip()
        if desc.startswith("** VOID **"):
            voids.append(desc); 
            # remove last matching item with same price
            for k in range(len(items) - 1, -1, -1):
                if items[k][1] == -amt(m) and items[k][0].startswith(desc[11:].strip()):
                    items.pop(k); break
            continue
        if SKIP.match(desc):
            key = "subtotal" if desc.startswith("SUBTOTAL") else "tax" if desc.startswith("TAX ") or desc == "TAX" else "total" if desc in ("**** TOTAL", "**** BALANCE", "TOTAL") else None
            if key and key not in got: got[key] = amt(m)
            continue
        items.append((desc, amt(m), m["flag"] == tflag))
    e = exp[fn]
    sub = sum((i[1] for i in items), D(0))
    base = sum((i[1] for i in items if i[2]), D(0))
    tax = (base * rate).quantize(D("0.01"), rounding=ROUND_HALF_UP)
    check(sub == got.get("subtotal"), f"{fn}: item sum {sub} != printed subtotal {got.get('subtotal')}")
    check(tax == got.get("tax"), f"{fn}: computed tax {tax} != printed {got.get('tax')}")
    check(got.get("subtotal", 0) + got.get("tax", 0) == got.get("total"), f"{fn}: subtotal+tax != total")
    check(D(str(e["subtotal"])) == sub and D(str(e["tax"])) == tax and D(str(e["total"])) == sub + tax, f"{fn}: expected.json totals mismatch")
    check([(i[0], i[1]) for i in items] == [(x["raw_text"], D(str(x["price"]))) for x in e["items"]], f"{fn}: expected items != printed items")
    check([x["taxable"] for x in e["items"]] == [i[2] for i in items], f"{fn}: taxable flags mismatch")
    for x in e["items"]: check(x["category"] in VALID, f"{fn}: bad category {x['category']}")
    mmddyy = f'{e["date"][5:7]}/{e["date"][8:10]}/{e["date"][2:4]}'
    check(any(l.startswith(mmddyy) for l in lines), f"{fn}: date {mmddyy} not printed")
    check(len(voids) == len(e["voided_lines"]), f"{fn}: void count mismatch")
check(any(exp[f]["voided_lines"] for f in exp), "no receipt has a voided item")
if errors:
    print("FAIL"); print("\n".join(errors)); sys.exit(1)
print(f"OK: {len(cats)} shelf-life categories, {len(sl['examples'])} examples, {len(rl)} receipt lines "
      f"({sum(r['observed'] for r in rl)} observed), {len(al)} allergens, {len(txts)} receipts verified")
