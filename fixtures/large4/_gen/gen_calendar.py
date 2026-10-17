"""Calendar edge cases for mobile/src/lib/calendar.ts findFreeMealWindows. Expected windows come from the documented port
(_gen/cal_port.py); validate.py checks them with independent invariants and (TS_PATH) against the real calendar.ts.
Recurring events are expanded here the way Calendar.listEvents returns occurrences (wall-clock time kept in the event's zone).
python3 -B gen_calendar.py"""
import datetime as dt
from zoneinfo import ZoneInfo
from core4 import *
from cal_port import find_free_meal_windows, local_ms, local_fields, range_end, MIN

OUT = os.path.join(LARGE4, "calendar_windows")
DST_TZ = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/St_Johns", "Europe/London", "Europe/Berlin",
          "Europe/Lisbon", "Australia/Sydney", "Australia/Lord_Howe", "Pacific/Auckland", "Pacific/Chatham"]
FIXED_TZ = ["UTC", "Asia/Kolkata", "Asia/Kathmandu", "Asia/Tokyo", "America/Phoenix", "Asia/Singapore", "America/Sao_Paulo"]
ALL_TZ = DST_TZ + FIXED_TZ
T0, T1 = dt.datetime(2026, 10, 18, tzinfo=dt.timezone.utc), dt.datetime(2027, 12, 20, tzinfo=dt.timezone.utc)
AVAIL = ["busy", "tentative", "unavailable", "notSupported"]
TITLES = ["Standup", "1:1", "Dentist", "Team lunch", "Gym", "School pickup", "Flight", "Workshop", "Call", "Errands", "Soccer practice", "Book club"]

def transitions(tz):
    z = ZoneInfo(tz); out = []; t = T0; prev = t.astimezone(z).utcoffset()
    while t < T1:
        t2 = t + dt.timedelta(hours=1); o = t2.astimezone(z).utcoffset()
        if o != prev: out.append(t2); prev = o
        t = t2
    return out
TRANS = {tz: transitions(tz) for tz in DST_TZ}

def iso(tz, ms):
    w = dt.datetime.fromtimestamp(ms // 1000, ZoneInfo(tz)).replace(microsecond=(ms % 1000) * 1000)
    return w.isoformat(timespec="milliseconds")
def iso_z(ms): return dt.datetime.fromtimestamp(ms // 1000, dt.timezone.utc).replace(microsecond=(ms % 1000) * 1000).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

class Builder:
    def __init__(s, rng, tz, now_ms): s.rng, s.tz, s.now, s.events = rng, tz, now_ms, []
    def day(s, d): w = local_fields(s.tz, s.now); return (w.year, w.month, w.day, d)
    def ev(s, d, h, m, minutes, tz=None, avail=None, all_day=False, rec=None, title=None, sec=0, end_day=None, end_hm=None):
        tz = tz or s.tz; tot = (d * 24 + h) * 60 + m; d, h, m = tot // 1440, (tot % 1440) // 60, tot % 60
        y, mo, dd, off = s.day(d)
        st = local_ms(tz, y, mo, dd, h, m, sec, day_offset=off)
        en = local_ms(tz, y, mo, dd, end_hm[0], end_hm[1], day_offset=end_day) if end_day is not None else st + minutes * MIN
        if all_day:
            st = local_ms(tz, y, mo, dd, day_offset=off); en = local_ms(tz, y, mo, dd, day_offset=off + max(1, minutes // 1440))
        e = dict(id=f"E{len(s.events):03d}", title=title or s.rng.choice(TITLES), tz=tz, start=iso(tz, st), end=iso(tz, en),
                 start_ms=st, end_ms=en, all_day=all_day, availability=avail or s.rng.choices(AVAIL, [8, 2, 1, 1])[0])
        if rec: e["recurrence"] = rec
        s.events.append(e); return e

WD = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"]
def expand(e, lo, hi):
    """Occurrences of a (possibly recurring) event overlapping [lo, hi): wall-clock start kept in e.tz, absolute duration kept."""
    if "recurrence" not in e:
        return [dict(event_id=e["id"], occurrence=0, start_ms=e["start_ms"], end_ms=e["end_ms"])] if e["start_ms"] < hi and e["end_ms"] > lo else []
    r = e["recurrence"]; z = ZoneInfo(e["tz"]); w = dt.datetime.fromtimestamp(e["start_ms"] // 1000, z); dur = e["end_ms"] - e["start_ms"]
    out = []; k = 0; n = 0; day = w.date()
    until = dt.date.fromisoformat(r["until"]) if r.get("until") else None
    while n < 400:
        if r["freq"] == "daily": cand = day + dt.timedelta(days=k * r["interval"]); ok = True
        else:
            cand = day + dt.timedelta(days=k); wk = (cand - day).days // 7
            ok = WD[cand.weekday()] in r["byday"] and wk % r["interval"] == 0
        k += 1
        if until and cand > until: break
        if not ok: continue
        n += 1
        if r.get("count") and n > r["count"]: break
        if cand.isoformat() in r.get("exdates", []): continue
        st = int(dt.datetime(cand.year, cand.month, cand.day, w.hour, w.minute, w.second, tzinfo=z, fold=0).timestamp()) * 1000
        if st >= hi: break
        if st + dur > lo: out.append(dict(event_id=e["id"], occurrence=n - 1, start_ms=st, end_ms=st + dur))
    return out

def make(kind, rng, k):
    tz = rng.choice(ALL_TZ); days = 3; access = "granted"
    if kind == "dst_transition":
        tz = rng.choice(DST_TZ); t = rng.choice(TRANS[tz]); now = int((t - dt.timedelta(hours=rng.randint(1, 70))).timestamp()) * 1000
    else:
        now = int((T0 + dt.timedelta(seconds=rng.randint(0, int((T1 - T0).total_seconds()) - 10 * 86400))).timestamp()) * 1000
    w = local_fields(tz, now)
    # snap 'now' to a realistic planning time unless the case is about timing
    if kind not in ("now_inside_window", "dst_transition"):
        now = local_ms(tz, w.year, w.month, w.day, rng.choice([7, 8, 9, 10, 11]), rng.choice([0, 5, 15, 30, 44, 59]))
    if kind == "now_inside_window":
        h, m = rng.choice([(11, 29), (11, 31), (11, 45), (13, 39), (13, 40), (13, 41), (13, 46), (17, 15), (18, 1), (20, 39), (20, 40), (20, 41), (20, 55), (21, 0), (23, 59), (0, 0), (14, 0)])
        now = local_ms(tz, w.year, w.month, w.day, h, m, rng.randint(0, 59), rng.randint(0, 999))
    B = Builder(rng, tz, now); notes = []
    def around(meal):
        return (rng.choice([11, 12, 12, 13]), rng.choice([0, 15, 30, 45, 10, 50])) if meal == "lunch" else (rng.choice([17, 18, 19, 20]), rng.choice([0, 15, 30, 45, 5, 55]))
    if kind == "empty_calendar": pass
    elif kind in ("permission_denied", "read_error"):
        access = "denied" if kind == "permission_denied" else "read_error"
        for _ in range(rng.randint(0, 4)): B.ev(rng.randint(0, 2), *around(rng.choice(["lunch", "dinner"])), rng.choice([30, 60, 90]))
    elif kind == "single_event":
        B.ev(rng.randint(0, 2), *around(rng.choice(["lunch", "dinner"])), rng.choice([15, 30, 45, 60, 90, 120, 150]), sec=rng.choice([0, 0, 0, 30]))
    elif kind == "overlapping":
        for _ in range(rng.randint(2, 5)):
            d = rng.randint(0, 2); meal = rng.choice(["lunch", "dinner"]); h, m = around(meal); B.ev(d, h, m, rng.choice([30, 45, 60, 90]))
            B.ev(d, h, m + rng.choice([10, 15, 20, 25]), rng.choice([20, 30, 60]))
    elif kind == "back_to_back":
        for d in range(rng.randint(1, 3)):
            for meal, (h0, m0), (h1, m1) in [("lunch", (11, 30), (14, 0)), ("dinner", (17, 30), (21, 0))]:
                t = h0 * 60 + m0 - rng.choice([0, 10, 30]); stop = h1 * 60 + m1 + 10
                while t < stop:
                    L = rng.choice([25, 30, 45, 50]); B.ev(d, t // 60, t % 60, L); t += L + rng.choice([0, 0, 19, 20, 21, 5])
    elif kind == "multi_day":
        d = rng.randint(0, 1); B.ev(d, rng.choice([9, 12, 13, 18]), rng.choice([0, 30]), 0, end_day=d + rng.randint(1, 3), end_hm=(rng.choice([10, 12, 14, 19, 21]), rng.choice([0, 30])))
        notes.append("timed multi-day event (not allDay) blocks every window it spans")
    elif kind == "crosses_midnight":
        for d in range(rng.randint(1, 3)):
            B.ev(d, rng.choice([20, 21, 22, 23]), rng.choice([0, 30, 45]), rng.choice([90, 180, 300, 900, 960]))
    elif kind in ("recurring", "dst_recurring"):
        for _ in range(rng.randint(1, 3)):
            meal = rng.choice(["lunch", "dinner"]); h, m = around(meal); etz = tz if rng.random() < 0.6 else rng.choice(ALL_TZ)
            if etz != tz:  # keep the occurrence near the device's meal time
                st = local_ms(tz, w.year, w.month, w.day, h, m); ew = local_fields(etz, st); h, m = ew.hour, ew.minute
                d0 = (ew.date() - local_fields(tz, st).date()).days
            else: d0 = 0
            rec = dict(freq=rng.choice(["daily", "weekly"]), interval=rng.choice([1, 1, 1, 2]))
            if rec["freq"] == "weekly": rec["byday"] = sorted(rng.sample(WD, rng.randint(1, 5)), key=WD.index)
            if rng.random() < 0.5: rec["count"] = rng.randint(1, 12)
            else: rec["until"] = (w.date() + dt.timedelta(days=rng.randint(0, 6))).isoformat()
            if rng.random() < 0.3: rec["exdates"] = [(w.date() + dt.timedelta(days=rng.randint(0, 3))).isoformat()]
            e = B.ev(rng.randint(-3, 0) + d0, h, m, rng.choice([30, 45, 60, 90]), tz=etz, rec=rec)
    elif kind == "dst_transition":
        days = rng.choice([3, 3, 4, 7])
        for _ in range(rng.randint(0, 4)):
            meal = rng.choice(["lunch", "dinner"]); h, m = around(meal)
            if rng.random() < 0.5:
                etz = rng.choice(["UTC", "Asia/Tokyo", "America/Phoenix"] + DST_TZ)
                st = local_ms(tz, w.year, w.month, w.day, h, m); ew = local_fields(etz, st); d0 = (ew.date() - w.date()).days
                B.ev(d0 - 1, ew.hour, ew.minute, rng.choice([30, 60, 90]), tz=etz, rec=dict(freq="daily", interval=1, count=rng.randint(3, 8)))
                notes.append("recurring event in another zone: device-local time shifts across the transition")
            else: B.ev(rng.randint(0, days - 1), h, m, rng.choice([30, 60]))
    elif kind == "foreign_tz_events":
        for _ in range(rng.randint(1, 4)):
            etz = rng.choice(ALL_TZ); meal = rng.choice(["lunch", "dinner"]); h, m = around(meal)
            st = local_ms(tz, w.year, w.month, w.day, h, m, day_offset=rng.randint(0, 2)); ew = local_fields(etz, st)
            B.ev((ew.date() - w.date()).days, ew.hour, ew.minute, rng.choice([30, 45, 60, 120]), tz=etz)
    elif kind == "fully_booked":
        for d in range(3):
            B.ev(d, 11, rng.choice([0, 30]), 0, end_day=d, end_hm=(14, rng.choice([0, 15])))
            if rng.random() < 0.8: B.ev(d, 17, rng.choice([0, 30]), 0, end_day=d, end_hm=(21, 0))
            else: B.ev(d, 17, 30, 0, end_day=d, end_hm=(20, 41)); notes.append("19 minutes left before 21:00")
    elif kind == "all_day_and_free":
        for d in range(3):
            B.ev(d, 0, 0, 1440 * rng.choice([1, 1, 2]), all_day=True, avail="busy", title="Vacation")
            B.ev(d, *around("lunch"), 120, avail="free", title="Focus (free)")
            B.ev(d, *around("dinner"), rng.choice([30, 60]), avail=rng.choice(["tentative", "unavailable", "notSupported", "busy"]))
    elif kind == "now_inside_window":
        for _ in range(rng.randint(0, 2)): B.ev(rng.randint(0, 1), *around(rng.choice(["lunch", "dinner"])), rng.choice([20, 30, 60]))
    elif kind == "days_variants":
        days = rng.choice([0, 1, 2, 5, 7, 14])
        for _ in range(rng.randint(0, 6)): B.ev(rng.randint(0, max(days - 1, 0)), *around(rng.choice(["lunch", "dinner"])), rng.choice([30, 60, 90]))
    re_ms = range_end(tz, now, days)
    listed = []
    for e in B.events:
        for o in expand(e, now, re_ms):
            listed.append(dict(event_id=e["id"], occurrence=o["occurrence"], startDate=iso_z(o["start_ms"]), endDate=iso_z(o["end_ms"]),
                               start_ms=o["start_ms"], end_ms=o["end_ms"], allDay=e["all_day"], availability=e["availability"]))
    listed.sort(key=lambda x: (x["start_ms"], x["event_id"], x["occurrence"]))
    wins = find_free_meal_windows(tz, now, days, access, listed if access == "granted" else [])
    for x in wins: x["start"] = iso(tz, x["start_ms"]); x["end"] = iso(tz, x["end_ms"])
    for e in B.events: e.pop("start_ms"); e.pop("end_ms")
    trans_in = [t.isoformat() for t in TRANS.get(tz, []) if now <= t.timestamp() * 1000 < re_ms]
    return dict(id=f"C{k:05d}", kind=kind, device_tz=tz, now=iso(tz, now), now_ms=now, days=days, calendar_access=access,
                calendar_events=B.events, listed_events=listed, range=dict(start_ms=now, end_ms=re_ms),
                dst_transitions_in_range=trans_in, notes=sorted(set(notes)),
                expected=dict(windows=wins, count=len(wins)), synthetic=True)

PLAN = [("empty_calendar", 200), ("permission_denied", 150), ("read_error", 100), ("single_event", 200), ("overlapping", 250), ("back_to_back", 250),
        ("multi_day", 200), ("crosses_midnight", 200), ("recurring", 350), ("dst_transition", 400), ("foreign_tz_events", 200), ("fully_booked", 150),
        ("all_day_and_free", 150), ("now_inside_window", 150), ("days_variants", 50)]

def main():
    rng = random.Random(SEED4 + 300_000); rows = []
    for kind, n in PLAN:
        for _ in range(n): rows.append(make(kind, rng, len(rows)))
    jdump(os.path.join(OUT, "cases.jsonl"), rows)
    from collections import Counter
    print(len(rows), Counter(len(r["expected"]["windows"]) for r in rows).most_common(8), sum(1 for r in rows if r["dst_transitions_in_range"]),
          Counter(w["minutes"] for r in rows for w in r["expected"]["windows"]).most_common(6))

if __name__ == "__main__": main()
