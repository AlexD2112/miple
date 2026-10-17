"""Pantry state over time: receipts + consumption/discard/leftover events -> expected pantry state at checkpoints.
Rules (README "Pantry sequence rules"):
 lot = one app `items` row; duplicate lines (same name+unit) on ONE receipt merge into one lot (quantities add);
 expiry = purchase_date + shelf_life.json default-storage days, else (null there) + app shelf_life table days (0001_init.sql);
 a lot is expired on day d when expiry < d; consume = first-expiring-first over NON-expired active lots
 (tie: purchase_date, then lot_id); lot qty 0 -> status 'used'; discard -> 'wasted'; same-day order = events as listed;
 checkpoint state is taken after all events of that day. python3 gen_pantry_seq.py [--n 3000]"""
import argparse
from core3 import *

FOOD = [c for c in CATALOG if c["category"] in CATS]
def q2(x): return D(str(x)).quantize(D("0.01"), rounding=ROUND_HALF_UP)

def expiry(cat, pdate):
    c = CATS[cat]; days = c[f"{c['default_storage']}_days"]
    if days is not None: return pdate + dt.timedelta(days=days), "shelf_life.json", days
    app = c.get("app_category_key"); return pdate + dt.timedelta(days=APP_DAYS[app]), "app_shelf_life_table", APP_DAYS[app]

class Pantry:
    def __init__(s): s.lots = []; s.n = 0; s.used = {}; s.wasted = {}; s.short = []
    def add(s, name, cat, qty, unit, pdate, source, receipt_id=None):
        e, src, days = expiry(cat, pdate)
        s.n += 1
        s.lots.append(dict(lot_id=f"L{s.n:03d}", name=name, category=cat, app_category_key=CATS[cat].get("app_category_key"), quantity=q2(qty),
                           unit=unit, purchase_date=pdate, estimated_expiry=e, expiry_source=src, shelf_life_days=days, status="active",
                           source=source, receipt_id=receipt_id))
    def consume(s, name, qty, unit, day):
        need = q2(qty)
        lots = sorted([l for l in s.lots if l["name"] == name and l["unit"] == unit and l["status"] == "active" and l["estimated_expiry"] >= day],
                      key=lambda l: (l["estimated_expiry"], l["purchase_date"], l["lot_id"]))
        taken = []
        for l in lots:
            if need <= 0: break
            t = min(need, l["quantity"]); l["quantity"] -= t; need -= t; taken.append(dict(lot_id=l["lot_id"], quantity=float(t)))
            s.used[name] = s.used.get(name, D(0)) + t
            if l["quantity"] == 0: l["status"] = "used"
        if need > 0: s.short.append(dict(day=day.isoformat(), name=name, shortfall=float(need)))
        return taken, float(need)
    def discard_expired(s, day):
        out = []
        for l in s.lots:
            if l["status"] == "active" and l["estimated_expiry"] < day:
                l["status"] = "wasted"; s.wasted[l["name"]] = s.wasted.get(l["name"], D(0)) + l["quantity"]; out.append(l["lot_id"])
        return out
    def discard_lot(s, lot_id):
        l = next(l for l in s.lots if l["lot_id"] == lot_id)
        if l["status"] != "active": return False
        l["status"] = "wasted"; s.wasted[l["name"]] = s.wasted.get(l["name"], D(0)) + l["quantity"]; return True
    def state(s, day):
        act = sorted([l for l in s.lots if l["status"] == "active"], key=lambda l: (l["name"], l["estimated_expiry"], l["purchase_date"], l["lot_id"]))
        lots = [dict({k: (v.isoformat() if isinstance(v, dt.date) else float(v) if isinstance(v, D) else v) for k, v in l.items()},
                     days_left=(l["estimated_expiry"] - day).days) for l in act]
        totals = {}
        for l in act: totals.setdefault(f'{l["name"]}|{l["unit"]}', D(0)); totals[f'{l["name"]}|{l["unit"]}'] += l["quantity"]
        nxt = {}
        for l in act:
            if l["estimated_expiry"] >= day: nxt.setdefault(f'{l["name"]}|{l["unit"]}', l["lot_id"])
        return dict(day=day.isoformat(), active_lots=lots, totals={k: float(v) for k, v in totals.items()},
                    expired_active_lot_ids=[l["lot_id"] for l in act if l["estimated_expiry"] < day], next_to_use=nxt,
                    used_totals={k: float(v) for k, v in sorted(s.used.items())}, wasted_totals={k: float(v) for k, v in sorted(s.wasted.items())},
                    status_counts={st: sum(1 for l in s.lots if l["status"] == st) for st in ("active", "used", "wasted")})

def make(rng, k):
    start = dt.date(2026, 1, 1) + dt.timedelta(days=rng.randint(0, 700))
    if rng.random() < 0.08: start = rng.choice([dt.date(2027, 12, 20), dt.date(2028, 2, 20), dt.date(2026, 12, 24)])
    span = rng.randint(14, 56); staples = rng.sample(FOOD, rng.randint(4, 12))
    days = sorted(set([0] + rng.sample(range(1, span), min(span - 1, rng.randint(1, 5)))))
    events = []; P = Pantry(); checkpoints = []
    cps = sorted(set(rng.sample(range(1, span + 1), rng.randint(2, 5))))
    for d in range(span + 1):
        day = start + dt.timedelta(days=d)
        if d in days:
            rid = f"R{len([e for e in events if e['type'] == 'receipt']) + 1}"; lines = []
            for it in rng.sample(staples, rng.randint(2, min(8, len(staples)))):
                unit = "lb" if it["by_weight"] else "ea"
                qty = float(q2(rng.uniform(0.4, 3.5))) if unit == "lb" else rng.choice([1, 1, 1, 2, 3])
                lines.append(dict(name=it["name"], category=it["category"], quantity=qty, unit=unit))
                if rng.random() < 0.12: lines.append(dict(name=it["name"], category=it["category"], quantity=qty, unit=unit))  # duplicate line
            events.append(dict(day=day.isoformat(), type="receipt", receipt_id=rid, lines=lines))
            merged = {}
            for l in lines:
                key = (l["name"], l["unit"])
                if key in merged: merged[key]["quantity"] = float(q2(merged[key]["quantity"]) + q2(l["quantity"]))
                else: merged[key] = dict(l)
            for l in merged.values(): P.add(l["name"], l["category"], l["quantity"], l["unit"], day, "receipt", rid)
        if rng.random() < 0.06:
            events.append(dict(day=day.isoformat(), type="leftover", name="leftover " + rng.choice(["chili", "stir-fry", "soup", "pasta bake"]),
                               category="cooked leftovers", quantity=rng.choice([1, 2]), unit="ea"))
            e = events[-1]; P.add(e["name"], e["category"], e["quantity"], e["unit"], day, "leftover")
        for _ in range(rng.choice([0, 0, 1, 1, 2, 3])):
            act = [l for l in P.lots if l["status"] == "active" and (l["estimated_expiry"] >= day or rng.random() < 0.03)]
            if not act: break
            l = rng.choice(act)
            qty = float(q2(rng.uniform(0.2, 2.0))) if l["unit"] == "lb" else rng.choice([1, 1, 2])
            avail = sum((x["quantity"] for x in P.lots if x["name"] == l["name"] and x["unit"] == l["unit"] and x["status"] == "active" and x["estimated_expiry"] >= day), D(0))
            if rng.random() < 0.85 and avail > 0: qty = float(min(q2(qty), avail))
            elif rng.random() < 0.3: qty = float(q2(D(str(qty)) + 5))  # over-consume -> shortfall
            taken, short = P.consume(l["name"], qty, l["unit"], day)
            events.append(dict(day=day.isoformat(), type="consume", name=l["name"], quantity=qty, unit=l["unit"]))
        if rng.random() < 0.12:
            events.append(dict(day=day.isoformat(), type="discard_expired")); P.discard_expired(day)
        if rng.random() < 0.04:
            act = [l for l in P.lots if l["status"] == "active"]
            if act:
                l = rng.choice(act); events.append(dict(day=day.isoformat(), type="discard_lot", lot_id=l["lot_id"], reason="spoiled_early")); P.discard_lot(l["lot_id"])
        if d in cps: checkpoints.append(P.state(day))
    return dict(id=f"PS{k:05d}", start=start.isoformat(), end=(start + dt.timedelta(days=span)).isoformat(), events=events,
                checkpoints=checkpoints, shortfalls=P.short, synthetic=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=3000); a = ap.parse_args()
    rng = random.Random(SEED3 + 200_000); rows = [make(rng, k) for k in range(a.n)]
    for s0 in range(0, len(rows), 1000): jdump(os.path.join(LARGE3, "pantry_sequences", f"sequences_{s0 // 1000:03d}.jsonl"), rows[s0:s0 + 1000])
    print(len(rows), "events", sum(len(r["events"]) for r in rows), "checkpoints", sum(len(r["checkpoints"]) for r in rows),
          "lots", sum(r["checkpoints"][-1]["status_counts"]["active"] + r["checkpoints"][-1]["status_counts"]["used"] + r["checkpoints"][-1]["status_counts"]["wasted"] for r in rows),
          "shortfalls", sum(len(r["shortfalls"]) for r in rows), "dup-merge receipts", sum(1 for r in rows for e in r["events"] if e["type"] == "receipt" and len({(l["name"], l["unit"]) for l in e["lines"]}) < len(e["lines"])))

if __name__ == "__main__": main()
