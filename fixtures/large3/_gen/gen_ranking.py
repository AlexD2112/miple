"""Expiring-soon ranking: pantry (app Item shape, mobile/src/lib/types.ts) + today -> ordered use-first list.
Rule (README "Ranking rule"): active items with quantity > 0 and a known expiry not before today, sorted by
 1) days_left asc (daysUntil in mobile/src/lib/dates.ts), 2) app shelf_life table days for the category asc (more perishable first,
 supabase/migrations/0001_init.sql), 3) purchase_date asc, 4) name (casefold) asc, 5) id asc.
Expired (days_left < 0) and unknown-expiry items are listed separately; used/wasted/zero-quantity items are excluded.
python3 gen_ranking.py [--n 3000]"""
import argparse, uuid
from core3 import *

FOOD = [c for c in CATALOG if c["category"] in CATS]
def default_expiry(cat, pd):
    c = CATS[cat]; d = c[f"{c['default_storage']}_days"]
    return pd + dt.timedelta(days=d if d is not None else APP_DAYS[c["app_category_key"]])

def rank(items, today):
    act = [i for i in items if i["status"] == "active" and i["quantity"] > 0]
    excluded = [i["id"] for i in items if i not in act]
    known = [i for i in act if i["estimated_expiry"]]
    for i in known: i["_d"] = (dt.date.fromisoformat(i["estimated_expiry"]) - today).days
    key = lambda i: (i["_d"], APP_DAYS[i["category"]], i["purchase_date"], i["name"].casefold(), i["id"])
    use = sorted([i for i in known if i["_d"] >= 0], key=key); expired = sorted([i for i in known if i["_d"] < 0], key=key)
    unknown = sorted([i for i in act if not i["estimated_expiry"]], key=lambda i: (i["name"].casefold(), i["id"]))
    ties = sum(1 for a, b in zip(use, use[1:]) if a["_d"] == b["_d"])
    out = dict(use_first=[dict(id=i["id"], name=i["name"], days_left=i["_d"], urgency=round(1 / (1 + max(0, i["_d"])), 6)) for i in use],
               expired=[dict(id=i["id"], name=i["name"], days_left=i["_d"]) for i in expired], unknown_expiry=[i["id"] for i in unknown],
               excluded=excluded, top3=[i["id"] for i in use[:3]],
               expiring_within={str(n): [i["id"] for i in use if i["_d"] <= n] for n in (0, 1, 3, 7)}, adjacent_day_ties=ties)
    for i in known: i.pop("_d")
    return out

def make(rng, k):
    today = dt.date(2026, 1, 1) + dt.timedelta(days=rng.randint(0, 900))
    if rng.random() < 0.1: today = rng.choice([dt.date(2028, 2, 29), dt.date(2028, 3, 1), dt.date(2026, 12, 31), dt.date(2027, 1, 1), dt.date(2026, 11, 1), dt.date(2027, 3, 14)])
    items = []; u = uuid.UUID(int=rng.getrandbits(128))
    n = rng.randint(1, 30)
    tie_pd = today - dt.timedelta(days=rng.randint(0, 5))
    for j in range(n):
        it = rng.choice(FOOD); app = CATS[it["category"]]["app_category_key"]
        pd = tie_pd if rng.random() < 0.3 else today - dt.timedelta(days=rng.randint(0, 20))
        exp = default_expiry(it["category"], pd); src = "receipt"
        r = rng.random()
        if r < 0.08: exp = None; src = "manual"           # user cleared expiry
        elif r < 0.18: exp = today + dt.timedelta(days=rng.randint(-3, 10)); src = rng.choice(["manual", "leftover", "fridge_scan"])  # user/LLM-set expiry
        status = rng.choices(["active", "used", "wasted"], [10, 1, 1])[0]
        qty = 0 if rng.random() < 0.04 else (round(rng.uniform(0.2, 3), 2) if it["by_weight"] else rng.choice([1, 1, 2, 3]))
        iid = str(uuid.UUID(int=(u.int + j * 7919) % (1 << 128)))
        items.append(dict(id=iid, receipt_id=None, name=it["name"], raw_name=None, category=app, quantity=qty, unit="lb" if it["by_weight"] else "ea",
                          price=float(it["price"]), purchase_date=pd.isoformat(), estimated_expiry=exp.isoformat() if exp else None,
                          status=status, source=src, updated_at=f"{today.isoformat()}T08:00:00Z"))
    if rng.random() < 0.15 and items:  # exact duplicates except id -> pure id tie-break
        d = dict(rng.choice(items)); d["id"] = str(uuid.UUID(int=(u.int + 999_983) % (1 << 128))); items.append(d)
    rng.shuffle(items)
    return dict(id=f"X{k:05d}", today=today.isoformat(), pantry=items, expected=rank([dict(i) for i in items], today), synthetic=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=3000); a = ap.parse_args()
    rng = random.Random(SEED3 + 400_000); rows = [make(rng, k) for k in range(a.n)]
    jdump(os.path.join(LARGE3, "expiry_ranking", "cases.jsonl"), rows)
    print(len(rows), "items", sum(len(r["pantry"]) for r in rows), "use_first", sum(len(r["expected"]["use_first"]) for r in rows),
          "expired", sum(len(r["expected"]["expired"]) for r in rows), "ties", sum(r["expected"]["adjacent_day_ties"] for r in rows))

if __name__ == "__main__": main()
