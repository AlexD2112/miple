"""Adversarial / robustness receipts with labeled ground truth. python3 gen_adversarial.py"""
from rcore import *

PLAN = [("columns_misaligned", 200), ("column_split", 150), ("upside_down", 100), ("double_scan", 250), ("legit_repeat", 100),
        ("cut_off", 250), ("concatenated", 200), ("promo_noise", 250), ("flag_variants", 200), ("tax_exempt", 60),
        ("store_error", 200), ("very_long", 60), ("all_non_food", 120), ("all_return", 120)]
PROMO_HEADER = ["SURVEY CODE: {a}-{b}-{c}", "TELL US HOW WE DID  {a}{b}", "WIN A 500.00 GIFT CARD", "FUEL POINTS BALANCE     {p}",
                "REG {r2} TRN {a} OPR {r3}", "STORE MGR: J******", "OPEN 6AM - 12AM", "REWARDS #: ********{c}"]
PROMO_FOOTER = ["FUEL POINTS THIS ORDER        {p}", "REWARDS BALANCE           {m}", "TOTAL SAVINGS THIS YEAR   {m}",
                "SAVE 2.00 ON YOUR NEXT VISIT", "SURVEY CODE {a} {b} {c}", "VISIT OUR SURVEY - ENTER TO WIN 1000.00",
                "AUTH CODE  {a}{r2}", "CARD #: ************{c}", "BALANCE DUE                   0.00", "RETURNS WITHIN 90 DAYS",
                "BOTTLE RETURNS ACCEPTED    0.10/EA", "NEXT VISIT COUPON          3.00 OFF"]
PROMO_INLINE = ["   YOU SAVED {m}", "   ** MEMBER PRICE APPLIED **", "   REG PRICE {m}"]
FLAG_VARIANTS = [("T", "F", "T=TAXABLE  F=FOOD"), ("T", "N", "T=TAXABLE  N=NON-TAXABLE"), ("TX", "", "TX=TAXABLE ITEM"),
                 ("T", "", "T=TAXED ITEM"), ("A", "E", "A=TAXABLE  E=EXEMPT"), ("N", "F", "N=TAXABLE NON-FOOD  F=SNAP ELIGIBLE FOOD"),
                 ("B", "", "B=TAXABLE"), ("T", "S", "T=TAX  S=SNAP")]
AMTX = re.compile(r"^(?P<desc>\S.*?)(?P<gap>\s{2,})(?P<amt>\d+\.\d{2}-?(?:\s[A-Z]{1,2})?)\s*$")

def fill(rng, pat, extra=None):
    return pat.format(a=rng.randint(1000, 9999), b=rng.randint(1000, 9999), c=rng.randint(1000, 9999), p=rng.randint(5, 900),
                      r2=f"{rng.randint(1, 30):02d}", r3=rng.randint(100, 999), m=f"{rng.uniform(0.5, 400):.2f}")

def base(rng, rid, **kw):
    store = kw.pop("store", None); n = kw.pop("n", None); mode = kw.pop("mode", "normal"); repeat = kw.pop("repeat_legit", False)
    flags = kw.pop("flags", None)
    r = new_receipt(rng, rid, store=store)
    if flags: r.tf, r.ef = flags[0], flags[1]
    fill_items(r, n or rng.randint(3, 18), mode=mode, repeat_legit=repeat)
    if not r.items: return None
    if flags: kw["legend"] = flags[2]
    txt, exp = render(r, **kw)
    for i in exp["items"]: i["flag"] = r.flag(i["taxable"], i["category"])
    exp["flag_legend"] = dict(taxable=r.tf, nontaxable=r.ef)
    return txt, exp, r

def finalize(exp):
    exp = dict(exp); exp["items"] = [dict({k: v for k, v in i.items() if not k.startswith("_")}, source_line=i["_line"]) for i in exp["items"]]
    return exp

def make(cat, k):
    rng = random.Random(SEED2 + 100_000 + k); rid = f"A{k:05d}"
    rec = dict(id=rid, category=cat, truncated=False, duplicated=False, concatenated=False, store_error=None,
               ignored_lines=[], line_ops=[], synthetic=True)
    kw = {}
    if cat == "very_long": kw = dict(store=rng.choice(["Costco", "Costco", "Safeway", "Fred Meyer"]), n=rng.randint(150, 260))
    elif cat == "all_non_food": kw = dict(mode="non_food", n=rng.randint(2, 15))
    elif cat == "all_return": kw = dict(mode="returns", n=rng.randint(1, 6))
    elif cat == "legit_repeat": kw = dict(repeat_legit=True, n=rng.randint(3, 12))
    elif cat == "tax_exempt": kw = dict(tax_exempt=True, store=rng.choice(["Costco", "Target", "Safeway", "Fred Meyer"]))
    elif cat == "flag_variants": kw = dict(flags=rng.choice(FLAG_VARIANTS))
    elif cat == "promo_noise":
        kw = dict(header_extra=[fill(rng, p) for p in rng.sample(PROMO_HEADER, rng.randint(1, 3))],
                  footer_extra=[fill(rng, p) for p in rng.sample(PROMO_FOOTER, rng.randint(2, 5))])
    if cat == "tax_exempt":  # make sure something taxable is on it
        for _ in range(20):
            b = base(random.Random(rng.random()), rid, **dict(kw))
            if b and b[1]["taxable_base"] > 0 and b[1]["location"] != "OR": break
    elif cat == "store_error":
        b = base(rng, rid)
        txt, exp, r = b
        kind = rng.choice(["total_off", "tax_old_rate", "subtotal_missing_item"]) if exp["taxable_base"] > 0 and exp["location"] == "WA" else rng.choice(["total_off", "subtotal_missing_item"])
        sub, bs, tax, tot = totals(r)
        if kind == "total_off": pr = dict(total=tot + rng.choice([D("0.01"), D("-0.01"), D("0.10"), D("1.00"), D("-0.50")]))
        elif kind == "tax_old_rate":
            t2 = (bs * D("0.1035")).quantize(D("0.01"), rounding=ROUND_HALF_UP)
            if t2 == tax: t2 = tax + D("0.01")
            pr = dict(tax=t2, total=sub + t2)
        else:
            s2 = sub - D(str(r.items[-1]["price"])); pr = dict(subtotal=s2, total=s2 + tax)
        r.rng = random.Random(SEED2 + 150_000 + k)
        txt, exp = render(r, printed=pr)
        for i in exp["items"]: i["flag"] = r.flag(i["taxable"], i["category"])
        exp["flag_legend"] = dict(taxable=r.tf, nontaxable=r.ef)
        b = (txt, exp, r)
        mism = [f for f in ("subtotal", "tax", "total") if exp["printed"][f] != exp[f]]
        rec["store_error"] = dict(kind=kind, mismatched_fields=mism, computed={f: exp[f] for f in mism}, printed={f: exp["printed"][f] for f in mism})
    else:
        b = base(rng, rid, **kw)
    if b is None: return None
    txt, exp, r = b
    if exp["total"] == 0: return None
    src = [txt]; lines = txt.rstrip("\n").split("\n"); out = list(lines)
    item_lines = sorted({i["_line"] for i in exp["items"]})
    exps = [exp]
    if cat == "columns_misaligned":
        for li, l in enumerate(lines):
            m = AMTX.match(l)
            if not m or rng.random() < 0.5: continue
            op = rng.choice(["single_space", "leading_indent", "tab_gap", "jitter", "trailing_ws"])
            if op == "single_space": new = m["desc"] + " " + m["amt"]
            elif op == "leading_indent": new = " " * rng.randint(1, 3) + l
            elif op == "tab_gap": new = m["desc"] + "\t" + m["amt"]
            elif op == "jitter": new = m["desc"] + m["gap"] + " " * rng.randint(1, 4) + m["amt"]
            else: new = l + " " * rng.randint(1, 5)
            out[li] = new; rec["line_ops"].append(dict(line=li, op=op))
    elif cat == "column_split":
        a, bnd = lines.index("") + 1, lines.index("", lines.index("") + 1)
        descs, amts = [], []
        for l in lines[a:bnd]:
            m = AMTX.match(l)
            if m: descs.append(m["desc"]); amts.append(m["amt"])
            else: descs.append(l)
        out = lines[:a] + descs + [""] + amts + lines[bnd:]
        rec["line_ops"].append(dict(op="column_split", desc_block=[a, a + len(descs)], amount_block=[a + len(descs) + 1, a + len(descs) + 1 + len(amts)]))
    elif cat == "upside_down":
        out = lines[::-1]; rec["line_ops"].append(dict(op="line_order_reversed"))
    elif cat == "double_scan":
        rec["duplicated"] = True
        if rng.random() < 0.25:
            out = lines + [""] + lines; rec["line_ops"].append(dict(op="full_duplicate", start=0, end=len(lines), copy_start=len(lines) + 1))
        else:
            a0 = lines.index("") + 1; bnd = lines.index("", a0)
            s = rng.randint(a0, max(a0, bnd - 3)); e = min(bnd, s + rng.randint(3, 8))
            out = lines[:e] + lines[s:e] + lines[e:]
            rec["line_ops"].append(dict(op="overlap_duplicate", start=s, end=e, copy_start=e))
    elif cat == "cut_off":
        rec["truncated"] = True
        tot_line = next(i for i, l in enumerate(lines) if re.match(r"^(\*\*\*\* )?TOTAL\s", l))
        first = lines.index("") + 1
        cut = rng.randint(first, tot_line) if rng.random() < 0.85 else rng.randint(1, first)
        while cut > 1 and lines[cut - 1] == "": cut -= 1
        out = lines[:cut]; rec["line_ops"].append(dict(op="cut", keep_lines=cut))
        exp = dict(exp); exp["items"] = [i for i in exp["items"] if i["_line"] < cut]
        for f in ("subtotal", "taxable_base", "tax", "total", "printed", "tenders", "change", "item_count"): exp[f] = None
        exp["complete"] = False; exps = [exp]
    elif cat == "concatenated":
        rec["concatenated"] = True
        b2 = None
        while b2 is None or b2[1]["total"] == 0: b2 = base(rng, rid + "b")
        l2 = b2[0].rstrip("\n").split("\n"); sep = rng.choice([[], [""], ["", ""], ["-" * 40]])
        out = lines + sep + l2; src.append(b2[0]); exps = [exp, b2[1]]
        rec["line_ops"].append(dict(op="concat", second_starts_at=len(lines) + len(sep), separator=sep))
    elif cat == "promo_noise":
        rec["ignored_lines"] = list(kw["header_extra"]) + list(kw["footer_extra"])
        ins = sorted(rng.sample(item_lines, min(len(item_lines), rng.randint(0, 3))), reverse=True)
        for li in ins:
            p = fill(rng, rng.choice(PROMO_INLINE)); out.insert(li + 1, p); rec["ignored_lines"].append(p)
        if ins: rec["line_ops"].append(dict(op="inline_promo_inserted_after_source_lines", lines=sorted(ins)))
    rec["files"] = []
    rec["text_lines"] = len(out)
    rec["receipts"] = [finalize(e) for e in exps]
    return "\n".join(out) + "\n", src, rec

def main():
    root = os.path.join(LARGE2, "adversarial"); recs = []; k = 0
    for cat, n in PLAN:
        made = 0
        while made < n:
            res = make(cat, k); k += 1
            if res is None: continue
            txt, srcs, rec = res; i = len(recs); shard = f"{i // 100:03d}"
            rel = f"text/{shard}/{rec['id']}_{cat}.txt"
            os.makedirs(os.path.join(root, os.path.dirname(rel)), exist_ok=True)
            open(os.path.join(root, rel), "w").write(txt)
            rec["file"] = rel; rec["source_files"] = []
            for j, s in enumerate(srcs):
                sr = f"source/{shard}/{rec['id']}_{'ab'[j]}.txt"
                os.makedirs(os.path.join(root, os.path.dirname(sr)), exist_ok=True)
                open(os.path.join(root, sr), "w").write(s); rec["source_files"].append(sr)
            del rec["files"]; rec["seed"] = SEED2 + 100_000 + k - 1
            recs.append(rec); made += 1
    jdump(os.path.join(root, "expected.jsonl"), recs)
    from collections import Counter
    print(len(recs), Counter(r["category"] for r in recs), "max items", max(len(r["receipts"][0]["items"]) for r in recs))

if __name__ == "__main__": main()
