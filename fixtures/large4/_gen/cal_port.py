"""Documented Python port of mobile/src/lib/calendar.ts findFreeMealWindows (JS Date semantics in the device time zone).
Constants are parsed from the TypeScript source so they follow the app."""
import os, re, datetime as dt
from zoneinfo import ZoneInfo
from core4 import REPO
SRC = open(os.path.join(REPO, "mobile", "src", "lib", "calendar.ts")).read()
MEAL_WINDOWS = [(m, (int(a), int(b)), (int(c), int(d))) for m, a, b, c, d in
                re.findall(r'meal: "(\w+)" as const, start: \[(\d+), (\d+)\], end: \[(\d+), (\d+)\]', SRC)]
MIN_MINUTES = int(re.search(r"MIN_MINUTES = (\d+)", SRC).group(1)); MAX_MINUTES = int(re.search(r"MAX_MINUTES = (\d+)", SRC).group(1))
FALLBACK_MINUTES = int(re.search(r"FALLBACK_MINUTES = (\d+)", SRC).group(1))
assert [m for m, _, _ in MEAL_WINDOWS] == ["lunch", "dinner"] and (MIN_MINUTES, MAX_MINUTES, FALLBACK_MINUTES) == (20, 60, 40)
MIN = 60_000

def local_ms(tz, y, mo, d, h=0, mi=0, s=0, ms=0, day_offset=0):
    """new Date(y, mo-1, d + day_offset, h, mi, s, ms) in zone tz: wall time; skipped times resolve with the pre-transition offset
    (moves forward), repeated times take the earlier instant -- the JS/ECMAScript rule, which is also zoneinfo fold=0."""
    base = dt.date(y, mo, d) + dt.timedelta(days=day_offset)
    w = dt.datetime(base.year, base.month, base.day, h, mi, s, tzinfo=ZoneInfo(tz), fold=0)
    return int(w.timestamp()) * 1000 + ms

def local_fields(tz, t_ms):
    w = dt.datetime.fromtimestamp(t_ms / 1000, ZoneInfo(tz)); return w

def range_end(tz, now_ms, days):
    w = local_fields(tz, now_ms)
    return local_ms(tz, w.year, w.month, w.day, w.hour, w.minute, w.second, now_ms % 1000, day_offset=days)

def round_up_quarter(t): q = 15 * MIN; return -(-t // q) * q

def first_gap(frm, to, busy):
    cursor = frm
    for b in busy:
        if b[1] <= cursor: continue
        if b[0] >= to: break
        if b[0] - cursor >= MIN_MINUTES * MIN: return (cursor, b[0])
        cursor = max(cursor, b[1])
    return (cursor, to) if to - cursor >= MIN_MINUTES * MIN else None

def find_free_meal_windows(tz, now_ms, days, access, listed):
    """listed: events as returned by Calendar.listEvents (start_ms, end_ms, all_day, availability). access: granted|denied|read_error."""
    has_cal = access == "granted"
    busy = sorted([(e["start_ms"], e["end_ms"]) for e in listed if not e["allDay"] and e["availability"] != "free"], key=lambda b: b[0]) if has_cal else []
    w0 = local_fields(tz, now_ms); out = []
    for d in range(days):
        for meal, (sh, sm), (eh, em) in MEAL_WINDOWS:
            start = local_ms(tz, w0.year, w0.month, w0.day, sh, sm, day_offset=d); end = local_ms(tz, w0.year, w0.month, w0.day, eh, em, day_offset=d)
            frm = max(start, round_up_quarter(now_ms))
            if end - frm < MIN_MINUTES * MIN: continue
            gap = first_gap(frm, end, busy) if has_cal else (frm, min(end, frm + FALLBACK_MINUTES * MIN))
            if not gap: continue
            minutes = min(MAX_MINUTES, (gap[1] - gap[0]) // MIN)
            out.append(dict(start_ms=gap[0], end_ms=gap[0] + minutes * MIN, minutes=minutes, meal=meal, day_offset=d))
    return out
