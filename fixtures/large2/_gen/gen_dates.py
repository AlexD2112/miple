"""Receipt header/footer date-time format edge cases (synthetic store styles). python3 gen_dates.py [--n 6000] [--receipts 300]"""
import argparse
from zoneinfo import ZoneInfo
from rcore import *
LA = ZoneInfo("America/Los_Angeles")

MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
DAY = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
FULLMON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
FULLDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
def h12(t): return (t.hour % 12) or 12, ("AM" if t.hour < 12 else "PM")
def F(fid, d):
    h, ap = h12(d); y2 = f"{d.year % 100:02d}"
    return {
     "mdy2_24": f"{d:%m/%d}/{y2} {d:%H:%M}", "mdy4_24": f"{d:%m/%d/%Y %H:%M}", "mdy2_12": f"{d:%m/%d}/{y2} {h:02d}:{d:%M} {ap}",
     "mdy4_12s": f"{d:%m/%d/%Y} {h:02d}:{d:%M:%S} {ap}", "mdy4dash_12nospace": f"{d:%m-%d-%Y} {h}:{d:%M}{ap}",
     "mdy2dash_24s": f"{d:%m-%d}-{y2} {d:%H:%M:%S}", "monddyyyy_12": f"{MON[d.month-1]} {d.day:02d} {d.year} {h:02d}:{d:%M}{ap}",
     "iso_24s": f"{d:%Y-%m-%d %H:%M:%S}", "ddmonyy_24": f"{d.day:02d}-{MON[d.month-1]}-{y2} {d:%H:%M}",
     "dow_mon_dd_yyyy_12": f"{DAY[d.weekday()]} {MON[d.month-1]} {d.day:02d} {d.year} {h}:{d:%M} {ap}",
     "mdy_nopad_12": f"{d.month}/{d.day}/{y2} {h}:{d:%M} {ap}", "mdy2dot_24": f"{d:%m.%d}.{y2} {d:%H:%M}",
     "mon_d_yyyy_mixed_12": f"{FULLMON[d.month-1][:3]} {d.day}, {d.year} {h}:{d:%M} {ap.lower()}",
     "time_first_12": f"{h}:{d:%M} {ap} {d:%m/%d}/{y2}", "full_words_12": f"{FULLDAY[d.weekday()]}, {FULLMON[d.month-1]} {d.day}, {d.year} {h}:{d:%M} {ap}",
     "mdy4_24_tz": f"{d:%m/%d/%Y %H:%M}", "date_only_time_line": f"{d:%m/%d}/{y2}",
    }[fid]
FORMATS = ["mdy2_24", "mdy4_24", "mdy2_12", "mdy4_12s", "mdy4dash_12nospace", "mdy2dash_24s", "monddyyyy_12", "iso_24s", "ddmonyy_24",
           "dow_mon_dd_yyyy_12", "mdy_nopad_12", "mdy2dot_24", "mon_d_yyyy_mixed_12", "time_first_12", "full_words_12", "mdy4_24_tz", "date_only_time_line"]
# synthetic per-store style assignment (NOT observed from real receipts)
STORE_FORMATS = {"Safeway": ["mdy2_24", "mdy2_12", "mdy_nopad_12", "date_only_time_line"], "QFC": ["mdy2_12", "mdy2dash_24s", "mdy4_24"],
                 "Fred Meyer": ["mdy2_12", "mdy2dash_24s", "mdy4_24_tz"], "Trader Joe's": ["mdy4dash_12nospace", "mdy_nopad_12", "mon_d_yyyy_mixed_12"],
                 "Costco": ["mdy4_24", "mdy2_24", "iso_24s"], "Whole Foods": ["mdy2_24", "mdy4_12s", "dow_mon_dd_yyyy_12", "full_words_12"],
                 "Target": ["mdy4_12s", "time_first_12", "monddyyyy_12", "ddmonyy_24", "mdy2dot_24"]}
TAILS = {"Safeway": "  {a} {b2} {c4} {d4}", "QFC": "  {c4} {b2} {a} {b1}", "Fred Meyer": "  {c4} {b2} {a} {b1}", "Trader Joe's": "",
         "Costco": "  {a} {a} {c4} {b2}", "Whole Foods": "", "Target": ""}
SECONDS = {"mdy4_12s", "mdy2dash_24s", "iso_24s"}

def make_case(rng, k):
    store = STORES[k % 7]; fid = rng.choice(STORE_FORMATS[store]) if rng.random() < 0.7 else rng.choice(FORMATS)
    kind = rng.choices(["random", "after_midnight", "noon_midnight", "leap_day", "year_end", "dst_fall_back", "ambiguous_mmdd", "business_date"],
                       [10, 4, 2, 1, 2, 1, 2, 2])[0]
    d = dt.datetime(2024, 1, 1) + dt.timedelta(minutes=rng.randrange(0, 7 * 365 * 24 * 60))
    if kind == "after_midnight": d = d.replace(hour=rng.choice([0, 0, 1, 2]), minute=rng.randrange(60))
    elif kind == "noon_midnight": d = d.replace(hour=rng.choice([0, 12]), minute=rng.choice([0, 1, 5, 30, 59]))
    elif kind == "leap_day": d = d.replace(year=rng.choice([2024, 2028]), month=2, day=29)
    elif kind == "year_end": d = rng.choice([dt.datetime(2026, 12, 31, 23, rng.randrange(60)), dt.datetime(2027, 1, 1, 0, rng.randrange(60)),
                                             dt.datetime(2029, 12, 31, 23, 59), dt.datetime(2030, 1, 1, 0, 3)])
    elif kind == "dst_fall_back": d = rng.choice([dt.datetime(2026, 11, 1, 1, rng.randrange(60)), dt.datetime(2027, 11, 7, 1, rng.randrange(60))])
    elif kind == "ambiguous_mmdd": m, dd = rng.sample(range(1, 13), 2); d = d.replace(month=m, day=dd)
    d = d.replace(second=rng.randrange(60) if fid in SECONDS else 0)
    lines = [l.format(n=f"{rng.randint(1, 3999):04d}", city=LOCATIONS["WA"]["city"], p=f"{rng.randint(0, 9999):04d}") for l in G.HEADERS[store]]
    stamp = F(fid, d)
    tail = TAILS[store].format(a=rng.randint(100, 999), b1=rng.randint(1, 9), b2=f"{rng.randint(1, 40):02d}", c4=rng.randint(1000, 9999), d4=rng.randint(1000, 9999))
    biz = None
    if kind == "business_date":
        d = d.replace(hour=rng.choice([0, 1]), minute=rng.randrange(60)); stamp = F(fid, d)
        biz = (d.date() - dt.timedelta(days=1))
        lines.append(f"BUSINESS DATE {biz:%m/%d/%y}")
    if fid == "mdy4_24_tz": stamp += " " + d.replace(tzinfo=LA, fold=0).tzname()
    lines.append(stamp + tail)
    if fid == "date_only_time_line": lines.append(f"TIME: {d:%H:%M}")
    lines.append(f"ITEMS {rng.randint(1, 30)}   REG {rng.randint(1, 20):02d}  TRANS {rng.randint(1000, 9999)}")
    exp = dict(date=d.date().isoformat(), time=d.strftime("%H:%M"), seconds=d.second if fid in SECONDS else None,
               two_digit_year=("y2" in fid or fid in ("ddmonyy_24", "mdy_nopad_12", "time_first_12", "date_only_time_line", "mdy2dot_24", "mdy2dash_24s")),
               clock="12h" if ("12" in fid) else "24h", timezone=("America/Los_Angeles" if fid == "mdy4_24_tz" else None),
               tz_abbrev=stamp.split()[-1] if fid == "mdy4_24_tz" else None,
               after_midnight=d.hour < 3, ambiguous_local_time=(kind == "dst_fall_back"),
               business_date=biz.isoformat() if biz else None)
    return dict(id=f"D{k:05d}", store=store, format_id=fid, edge_kind=kind, text="\n".join(lines), expected=exp, synthetic=True)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=6000); ap.add_argument("--receipts", type=int, default=300); a = ap.parse_args()
    rng = random.Random(SEED2 + 400_000)
    cases = [make_case(rng, k) for k in range(a.n)]
    root = os.path.join(LARGE2, "dates"); jdump(os.path.join(root, "header_cases.jsonl"), cases)
    # full receipts whose date line uses one of the formats
    recs = []; k = 0
    while len(recs) < a.receipts:
        seed = SEED2 + 450_000 + k; k += 1; r2 = random.Random(seed)
        c = make_case(r2, k)
        r = new_receipt(r2, f"DR{len(recs):04d}", store=c["store"])
        r.date = dt.date.fromisoformat(c["expected"]["date"]); r.time = c["expected"]["time"]
        fill_items(r, r2.randint(2, 10))
        stamp_lines = c["text"].split("\n")[len(G.HEADERS[c["store"]]):]
        txt, exp = render(r, date_line_text="\n".join(stamp_lines))
        if exp["total"] <= 0: continue
        for i in exp["items"]: i["flag"] = r.flag(i["taxable"], i["category"])
        exp["flag_legend"] = dict(taxable=r.tf, nontaxable=r.ef)
        exp["items"] = [dict({x: v for x, v in i.items() if not x.startswith("_")}, source_line=i["_line"]) for i in exp["items"]]
        rel = f"receipts/{r.rid}_{c['format_id']}.txt"
        os.makedirs(os.path.join(root, "receipts"), exist_ok=True); open(os.path.join(root, rel), "w").write(txt)
        recs.append(dict(id=r.rid, file=rel, format_id=c["format_id"], edge_kind=c["edge_kind"], date_expected=c["expected"], receipt=exp, seed=seed, synthetic=True))
    jdump(os.path.join(root, "receipts_expected.jsonl"), recs)
    from collections import Counter
    print(len(cases), Counter(c["format_id"] for c in cases).most_common(20), Counter(c["edge_kind"] for c in cases), len(recs))

if __name__ == "__main__": main()
