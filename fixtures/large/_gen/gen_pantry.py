"""Pantry/expiry cases: expiry = purchase_date + <storage>_days from ../../shelf_life.json (null if null).
python3 gen_pantry.py [--n 12000]"""
import os, json, random, argparse, datetime as dt
from common import *

EDGE_DATES = [dt.date(2024, 2, 28), dt.date(2024, 2, 29), dt.date(2028, 2, 28), dt.date(2028, 2, 29), dt.date(2027, 2, 28),
              dt.date(2026, 12, 31), dt.date(2026, 12, 30), dt.date(2025, 12, 31), dt.date(2026, 1, 31), dt.date(2026, 3, 31),
              dt.date(2026, 4, 30), dt.date(2026, 11, 30), dt.date(2027, 12, 29), dt.date(2026, 2, 28), dt.date(2026, 10, 17)]

def case(cid, ex, date, storage):
    c = CATS[ex["category"]]
    st = storage or c["default_storage"]
    days = c[f"{st}_days"]
    exp = (date + dt.timedelta(days=days)).isoformat() if days is not None else None
    tags = []
    if days is None: tags.append("null_shelf_life")
    else:
        e = date + dt.timedelta(days=days)
        if e.year != date.year: tags.append("year_rollover")
        elif e.month != date.month: tags.append("month_rollover")
        lo, hi = sorted([date, e])
        if any(dt.date(y, 2, 29) >= lo and dt.date(y, 2, 29) <= hi for y in (2024, 2028)): tags.append("spans_leap_day")
    if date.month == 2 and date.day == 29: tags.append("purchased_on_leap_day")
    if storage and storage != c["default_storage"]: tags.append(f"non_default_storage:{storage}")
    return dict(id=cid, item=ex["item"], purchase_date=date.isoformat(), requested_storage=storage,
                expected_category=ex["category"], expected_app_category_key=c.get("app_category_key"),
                expected_storage=st, shelf_life_days=days, expected_expiry_date=exp,
                foodkeeper_product_ids=c["foodkeeper_product_ids"], tags=tags, synthetic=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=12000); a = ap.parse_args()
    rng = random.Random(SEED + 3); ex = SHELF["examples"]; rows = []
    # 1) every example x every storage x every edge date (exhaustive edge grid)
    for e in ex:
        for d in rng.sample(EDGE_DATES, 4):
            for st in (None, "fridge", "pantry", "freezer"):
                rows.append(case(f"P{len(rows):06d}", e, d, st))
    # 2) random fill
    while len(rows) < a.n:
        e = rng.choice(ex); d = rand_date(rng, dt.date(2024, 1, 1), dt.date(2028, 12, 31))
        st = rng.choice([None, None, None, "fridge", "pantry", "freezer"])
        rows.append(case(f"P{len(rows):06d}", e, d, st))
    out = os.path.join(LARGE, "pantry"); os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "expiry_cases.jsonl"), "w") as f:
        for r in rows: f.write(json.dumps(r, separators=(",", ":")) + "\n")
    from collections import Counter
    print(len(rows), Counter(t for r in rows for t in r["tags"]).most_common(12), sum(r["expected_expiry_date"] is None for r in rows))

if __name__ == "__main__": main()
