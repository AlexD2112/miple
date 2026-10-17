"""Planner scenarios: pantry snapshot (expiry from shelf_life.json), macro targets, allergy profile, calendar events, now.
Derived fields only where deterministic (no recipe outputs). python3 gen_planner.py [--n 3000]"""
import os, json, random, argparse, datetime as dt
from common import SEED, LARGE, SHELF, CATS
from planner_logic import free_windows, days_until, busy_blocks, F
from allergen_matcher import analyze

APP_ALLERGIES = ["peanut", "tree_nut", "milk", "egg", "wheat", "gluten", "soy", "fish", "shellfish", "sesame"]
TITLES = ["Standup", "1:1", "Lecture CSE 312", "Gym", "Lab section", "Team sync", "Dentist", "Study group", "Commute", "Office hours",
          "Hackathon judging", "Interview", "Flight", "Soccer practice", "Club meeting", "Focus time"]
EDGE_NOWS = ["2028-02-29T11:52", "2026-12-31T17:44", "2026-01-31T13:41", "2026-11-01T10:00", "2027-03-14T12:00", "2026-10-17T20:41",
             "2026-10-17T20:40", "2026-10-17T11:30", "2026-10-17T13:40", "2026-10-17T13:41", "2026-10-18T00:00", "2026-06-30T21:05"]

def ev(i, s, e, all_day=False, avail="busy", title=None, rng=None):
    return dict(id=f"e{i}", title=title or rng.choice(TITLES), start=F(s), end=F(e), all_day=all_day, availability=avail)

def make_events(rng, now, days):
    evs = []; i = 0
    day0 = now.date()
    for d in range(-1, days + 1):
        day = day0 + dt.timedelta(days=d)
        for _ in range(rng.choice([0, 1, 2, 3, 4, 5])):
            h = rng.choice([9, 10, 11, 11, 12, 12, 13, 14, 16, 17, 17, 18, 18, 19, 20]); m = rng.choice([0, 10, 15, 20, 30, 40, 45, 50])
            s = dt.datetime.combine(day, dt.time(h, m)); dur = rng.choice([15, 19, 20, 30, 45, 50, 60, 90, 120, 180])
            avail = rng.choices(["busy", "free", "tentative"], [8, 1, 1])[0]
            evs.append(ev(i, s, s + dt.timedelta(minutes=dur), avail=avail, rng=rng)); i += 1
        if rng.random() < 0.08:
            evs.append(ev(i, dt.datetime.combine(day, dt.time(0)), dt.datetime.combine(day + dt.timedelta(days=1), dt.time(0)), all_day=True,
                          title=rng.choice(["Holiday", "Birthday", "OOO", "DubHacks"]), rng=rng)); i += 1
        if rng.random() < 0.15:  # back-to-back blocks leaving an exact 19/20-minute hole
            hole = rng.choice([19, 20, 21]); s = dt.datetime.combine(day, dt.time(17, 30))
            evs.append(ev(i, s, s + dt.timedelta(minutes=40), rng=rng)); i += 1
            s2 = s + dt.timedelta(minutes=40 + hole); evs.append(ev(i, s2, s2 + dt.timedelta(minutes=60), rng=rng)); i += 1
    # listEvents(now, now+days) only returns events overlapping that range
    end = now + dt.timedelta(days=days)
    return [e for e in evs if dt.datetime.fromisoformat(e["end"]) > now and dt.datetime.fromisoformat(e["start"]) < end]

def item_allergens(name):
    r = analyze(name); keys = set(r["app_keys"])
    if "wheat" in keys: keys.add("gluten")  # documented: app 'gluten' allergy treated as wheat-containing (allergens.json has no barley/rye list)
    return sorted(keys), sorted(r["may_contain"])

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=3000); a = ap.parse_args()
    rng = random.Random(SEED + 5); ex = SHELF["examples"]; rows = []
    for k in range(a.n):
        if k < len(EDGE_NOWS) * 10: now = dt.datetime.fromisoformat(EDGE_NOWS[k % len(EDGE_NOWS)])
        else:
            now = dt.datetime(2026, 1, 1) + dt.timedelta(minutes=rng.randrange(0, 3 * 365 * 24 * 60))
            if rng.random() < 0.3: now = now.replace(second=rng.randrange(60))
        days = rng.choices([3, 1, 2, 5, 7], [6, 1, 1, 1, 1])[0]
        has_cal = rng.random() > 0.15
        events = make_events(rng, now, days) if has_cal else []
        pantry = []
        for j in range(rng.randint(0, 25)):
            e = rng.choice(ex); c = CATS[e["category"]]
            storage = c["default_storage"] if rng.random() < 0.8 else rng.choice(["fridge", "pantry", "freezer"])
            days_sl = c[f"{storage}_days"]
            pdate = now.date() - dt.timedelta(days=rng.randint(0, 40))
            exp = (pdate + dt.timedelta(days=days_sl)).isoformat() if days_sl is not None else None
            al, may = item_allergens(e["item"])
            pantry.append(dict(id=f"i{j}", name=e["item"], category=c.get("app_category_key"), shelf_life_category=e["category"],
                               storage=storage, quantity=rng.choice([1, 1, 2, 0.5, 3]), unit=rng.choice(["ea", "pkg", "lb", "oz"]),
                               purchase_date=pdate.isoformat(), estimated_expiry=exp, name_allergen_keys=al, name_may_contain=may))
        allergies = sorted(rng.sample(APP_ALLERGIES, rng.choices([0, 1, 2, 3], [4, 3, 2, 1])[0]))
        cal = rng.choice([1600, 1800, 2000, 2200, 2400, 2600, 2800])
        pr, cr, fr = rng.choice([(0.3, 0.4, 0.3), (0.25, 0.5, 0.25), (0.35, 0.35, 0.3), (0.2, 0.55, 0.25)])
        profile = dict(allergies=allergies, calorie_target=cal, protein_target_g=round(cal * pr / 4), carbs_target_g=round(cal * cr / 4),
                       fat_target_g=round(cal * fr / 9), timezone="America/Los_Angeles")
        nows = F(now) if now.second == 0 else now.isoformat(timespec="seconds")
        exp_items = [p for p in pantry if p["estimated_expiry"]]
        derived = dict(
            excluded_item_ids=[p["id"] for p in pantry if set(p["name_allergen_keys"]) & set(allergies)],
            caution_item_ids=[p["id"] for p in pantry if not set(p["name_allergen_keys"]) & set(allergies)
                              and {x.replace("tree nuts", "tree_nut").replace("peanuts", "peanut").replace("eggs", "egg").replace("crustacean shellfish", "shellfish") for x in p["name_may_contain"]} & set(allergies)],
            expired_item_ids=[p["id"] for p in exp_items if days_until(p["estimated_expiry"], nows) < 0],
            expiring_within_days={str(n): [p["id"] for p in exp_items if 0 <= days_until(p["estimated_expiry"], nows) <= n] for n in (0, 1, 3, 7)},
            unknown_expiry_item_ids=[p["id"] for p in pantry if p["estimated_expiry"] is None],
            ignored_event_ids=[e["id"] for e in events if e["all_day"] or e["availability"] == "free"],
            macro_kcal_from_targets=4 * profile["protein_target_g"] + 4 * profile["carbs_target_g"] + 9 * profile["fat_target_g"],
            expected_free_windows=free_windows(nows, days, events, has_cal))
        rows.append(dict(id=f"S{k:05d}", now=nows, days=days, has_calendar_access=has_cal, profile=profile, pantry=pantry,
                         calendar_events=events, derived=derived, synthetic=True))
    out = os.path.join(LARGE, "planner"); os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "scenarios.jsonl"), "w") as f:
        for r in rows: f.write(json.dumps(r, separators=(",", ":")) + "\n")
    nw = [len(r["derived"]["expected_free_windows"]) for r in rows]
    print(len(rows), "windows", sum(nw), "zero-window", nw.count(0), "excluded", sum(len(r["derived"]["excluded_item_ids"]) for r in rows),
          "ignored_events", sum(len(r["derived"]["ignored_event_ids"]) for r in rows), "no_cal", sum(not r["has_calendar_access"] for r in rows))

if __name__ == "__main__": main()
