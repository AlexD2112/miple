"""Deterministic re-implementations used for planner fixtures (shared by generator and validator).
free_windows mirrors mobile/src/lib/calendar.ts findFreeMealWindows (local wall-clock, naive datetimes)."""
import datetime as dt
MEAL_WINDOWS = [("lunch", (11, 30), (14, 0)), ("dinner", (17, 30), (21, 0))]
MIN_MIN, MAX_MIN, FALLBACK = 20, 60, 40
P = lambda s: dt.datetime.fromisoformat(s)
F = lambda d: d.isoformat(timespec="minutes")

def round_up_quarter(t):
    base = t.replace(second=0, microsecond=0)
    if base != t: base += dt.timedelta(minutes=1)  # ceil to minute (matches ceil on ms when seconds>0)
    r = (-base.minute) % 15
    return base + dt.timedelta(minutes=r)

def busy_blocks(events, has_calendar):
    if not has_calendar: return []
    b = [(P(e["start"]), P(e["end"])) for e in events if not e["all_day"] and e["availability"] != "free"]
    return sorted(b, key=lambda x: x[0])

def first_gap(frm, to, busy):
    cur = frm; m = dt.timedelta(minutes=MIN_MIN)
    for s, e in busy:
        if e <= cur: continue
        if s >= to: break
        if s - cur >= m: return cur, s
        cur = max(cur, e)
    return (cur, to) if to - cur >= m else None

def free_windows(now_s, days, events, has_calendar):
    now = P(now_s); busy = busy_blocks(events, has_calendar); out = []
    rq = round_up_quarter(now)
    for d in range(days):
        day = now.date() + dt.timedelta(days=d)
        for meal, (sh, sm), (eh, em) in MEAL_WINDOWS:
            start = dt.datetime.combine(day, dt.time(sh, sm)); end = dt.datetime.combine(day, dt.time(eh, em))
            frm = max(start, rq)
            if end - frm < dt.timedelta(minutes=MIN_MIN): continue
            gap = first_gap(frm, end, busy) if has_calendar else (frm, min(end, frm + dt.timedelta(minutes=FALLBACK)))
            if not gap: continue
            minutes = min(MAX_MIN, int((gap[1] - gap[0]).total_seconds() // 60))
            out.append(dict(start=F(gap[0]), end=F(gap[0] + dt.timedelta(minutes=minutes)), minutes=minutes, meal=meal))
    return out

def days_until(iso, now_s):
    return (dt.date.fromisoformat(iso) - P(now_s).date()).days
