"""End-to-end pipeline cases: receipt text + purchase_date -> parsed items -> pantry items with expiry
(shelf_life.json default storage) -> allergen flags per profile (batch-1 matcher over allergens.json). python3 gen_e2e.py [--n 2000]"""
import argparse
from rcore import *
from allergen_matcher import analyze

APP = ["peanut", "tree_nut", "milk", "egg", "wheat", "gluten", "soy", "fish", "shellfish", "sesame"]
MAYMAP = {"tree nuts": "tree_nut", "peanuts": "peanut", "eggs": "egg", "crustacean shellfish": "shellfish"}
EDGE = [dt.date(2028, 2, 28), dt.date(2028, 2, 29), dt.date(2026, 12, 31), dt.date(2026, 12, 30), dt.date(2026, 1, 31), dt.date(2027, 2, 28)]

def allergen_keys(name):
    a = analyze(name); keys = set(a["app_keys"])
    if "wheat" in keys: keys.add("gluten")
    may = {MAYMAP.get(x, x) for x in a["may_contain"]}
    if "wheat" in may: may.add("gluten")
    return sorted(keys), sorted(may - keys)

def pantry_from(items, purchase_date):
    pantry, excluded = [], []
    for idx, i in enumerate(items):
        if i["line_type"] == "return":
            for p in reversed(pantry):
                if p["normalized_name"] == i["normalized_name"] and not p.get("_removed"):
                    p["_removed"] = True; break
            excluded.append(dict(item_index=idx, reason="return_removes_prior_entry")); continue
        if i["line_type"] != "sale": excluded.append(dict(item_index=idx, reason=i["line_type"])); continue
        if i["category"] not in CATS: excluded.append(dict(item_index=idx, reason=i["category"])); continue
        c = CATS[i["category"]]; st = c["default_storage"]; days = c[f"{st}_days"]
        exp = (purchase_date + dt.timedelta(days=days)).isoformat() if days is not None else None
        ak, mk = allergen_keys(i["normalized_name"])
        pantry.append(dict(item_index=idx, normalized_name=i["normalized_name"], raw_text=i["raw_text"], category=i["category"],
                           app_category_key=c.get("app_category_key"), quantity=i["quantity"], unit=i["unit"], storage=st,
                           shelf_life_days=days, purchase_date=purchase_date.isoformat(), estimated_expiry=exp,
                           allergen_keys=ak, may_contain_keys=mk))
    pantry = [p for p in pantry if not p.pop("_removed", False)]
    return pantry, excluded

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=2000); a = ap.parse_args()
    root = os.path.join(LARGE2, "e2e"); recs = []; k = 0
    while len(recs) < a.n:
        seed = SEED2 + 300_000 + k; k += 1; rng = random.Random(seed)
        r = new_receipt(rng, f"E{len(recs):05d}")
        if rng.random() < 0.15: r.date = rng.choice(EDGE)
        fill_items(r, rng.randint(2, 20))
        if rng.random() < 0.12:  # return one earlier sale item
            sold = [i for i in r.items if i["line_type"] == "sale" and i["unit"] == "ea" and i["quantity"] == 1]
            if sold:
                s = rng.choice(sold)
                add_tracked(r, "RETURN " + s["raw_text"], s["normalized_name"], -1, "ea", -s["price"], s["category"], s["taxable"],
                            line_type="return", detail_before="REFUND - ORIG RECEIPT")
                r.features.add("return")
        txt, exp = render(r)
        if exp["total"] <= 0: continue
        for i in exp["items"]: i["flag"] = r.flag(i["taxable"], i["category"])
        exp["flag_legend"] = dict(taxable=r.tf, nontaxable=r.ef)
        items = [dict({x: v for x, v in i.items() if not x.startswith("_")}, source_line=i["_line"]) for i in exp["items"]]
        exp["items"] = items
        pantry, excluded = pantry_from(items, r.date)
        profiles = []
        for _ in range(3):
            prof = sorted(rng.sample(APP, rng.choice([0, 1, 1, 2, 3])))
            profiles.append(dict(allergies=prof,
                                 flagged_pantry_indexes=[n for n, p in enumerate(pantry) if set(p["allergen_keys"]) & set(prof)],
                                 caution_pantry_indexes=[n for n, p in enumerate(pantry) if not set(p["allergen_keys"]) & set(prof) and set(p["may_contain_keys"]) & set(prof)]))
        i = len(recs); rel = f"receipts/{i // 100:03d}/{r.rid}_{r.store.lower().replace(' ', '').replace(chr(39), '')}.txt"
        os.makedirs(os.path.join(root, os.path.dirname(rel)), exist_ok=True); open(os.path.join(root, rel), "w").write(txt)
        recs.append(dict(id=r.rid, file=rel, input=dict(purchase_date=r.date.isoformat(), timezone="America/Los_Angeles"),
                         expected=dict(receipt=exp, pantry=pantry, excluded_lines=excluded, profiles=profiles), seed=seed, synthetic=True))
    jdump(os.path.join(root, "cases.jsonl"), recs)
    print(len(recs), "pantry entries", sum(len(x["expected"]["pantry"]) for x in recs), "null expiry", sum(p["estimated_expiry"] is None for x in recs for p in x["expected"]["pantry"]),
          "flags", sum(len(p["flagged_pantry_indexes"]) for x in recs for p in x["expected"]["profiles"]),
          "returns", sum("return" in x["expected"]["receipt"]["features"] for x in recs))

if __name__ == "__main__": main()
