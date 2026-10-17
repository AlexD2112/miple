"""Generate thousands of synthetic receipts (clean + ocr_noise) with JSONL ground truth.
Deterministic: python3 gen_receipts.py [--n 2400] [--noise 600]"""
import os, sys, json, random, argparse, re, datetime as dt
from decimal import Decimal as D, ROUND_HALF_UP
from common import *

FLAGS = {"Safeway": ("T", "S"), "QFC": ("T", "F"), "Fred Meyer": ("T", "F"), "Trader Joe's": ("T", ""),
         "Costco": ("A", "E"), "Whole Foods": ("T", "F"), "Target": ("T", "N")}
WIDTH = {"Costco": 44}
LOYALTY = {"Safeway": ["CLUB CARD SAVINGS", "J4U DIGITAL CPN", "J4U PERSONAL DEAL"], "QFC": ["KRO SAVINGS", "DIGITAL CPN", "MFR CPN"],
           "Fred Meyer": ["KRO SAVINGS", "DIGITAL CPN", "MFR CPN", "FM PLUS CARD SAV"], "Whole Foods": ["PRIME MEMBER DEAL", "PRIME 10% OFF"],
           "Target": ["TARGET CIRCLE OFFER", "CIRCLE DEAL"], "Costco": ["TPD/"], "Trader Joe's": []}
TENDERS = ["VISA", "MASTERCARD", "DEBIT", "AMEX", "DISCOVER"]
HEADERS = {"Safeway": ["SAFEWAY", "Store {n}  {city}", "(555) 010-{p}"], "QFC": ["QFC", "Quality Food Centers", "{city}  Store {n}"],
           "Fred Meyer": ["FRED MEYER", "{city}", "Store {n}"], "Trader Joe's": ["TRADER JOE'S", "Store #{n}  {city}", "OPEN 8:00AM TO 9:00PM DAILY"],
           "Costco": ["COSTCO", "WHOLESALE", "Warehouse #{n}  {city}"], "Whole Foods": ["WHOLE FOODS MARKET", "{city}", "(555) 020-{p}"],
           "Target": ["TARGET", "{city}  T-{n}", "(555) 030-{p}"]}
FEATURES = ["void", "coupon_section", "multibuy", "weight", "qty_detail", "deposit", "bag_fee", "non_food", "return",
            "price_override", "loyalty", "split_tender", "line_wrap", "truncation", "costco_item_numbers", "cash_change"]

def fmt(x):
    x = money(x); return f"{x:.2f}" if x >= 0 else f"{-x:.2f}-"

class R:
    def __init__(s, rng, rid):
        s.rng, s.rid = rng, rid
        s.store = rng.choice(STORES)
        s.loc = pick_weighted(rng, STORE_LOCATIONS[s.store])
        L = LOCATIONS[s.loc]; s.rate = L["rate"]
        s.W = WIDTH.get(s.store, 40)
        s.tf, s.ef = FLAGS[s.store]
        s.date = rand_date(rng); s.time = f"{rng.randint(7, 21):02d}:{rng.randint(0, 59):02d}"
        s.lines, s.items, s.voids, s.features = [], [], [], set()
        s.coupons = []
    def flag(s, tax, cat):
        if tax: return s.tf
        return "" if cat in ("fee", "deposit", "discount") else s.ef
    def row(s, desc, amount, flag):
        right = fmt(amount) + (" " + flag if flag else "  ")
        desc = desc[: s.W - len(right) - 2].rstrip()
        return desc, desc.ljust(s.W - len(right)) + right
    def add(s, raw, norm, qty, unit, price, cat, tax, line_type="sale", detail_before=None, detail_after=None, extra=None, wrap=False):
        price = money(price)
        out = []
        if detail_before: out.append("  " + detail_before)
        printed = None
        if wrap and len(raw) > s.W - 14:
            cut = raw.rfind(" ", 0, s.W - 16)
            if cut > 8:
                first, rest = raw[:cut], raw[cut + 1:]
                if not re.search(r"\d\.\d\d-?$", first):
                    out.append(first)
                    desc, line = s.row(rest, price, s.flag(tax, cat)); out.append(line)
                    printed = first + " " + desc; s.features.add("line_wrap")
        if printed is None:
            desc, line = s.row(raw, price, s.flag(tax, cat)); out.append(line); printed = desc
            if len(raw) > len(desc): s.features.add("truncation")
        if detail_after: out.append("     " + detail_after)
        s.lines.extend(out)
        it = dict(store=s.store, raw_text=printed, normalized_name=norm, quantity=qty, unit=unit, price=float(price),
                  category=cat, taxable=bool(tax), line_type=line_type, observed=False)
        if extra: it.update(extra)
        s.items.append(it)
        return it

def item_qty_price(r, it):
    rng = r.rng
    if it["by_weight"]:
        lo, hi = WEIGHT_RANGE.get(it["category"], (0.25, 4.0)); w = round(rng.uniform(lo, hi), 2)
        return w, "lb", money(D(str(w)) * it["price"]), f'{w:.2f} lb @ {it["price"]:.2f} /lb'
    q = rng.choice([1] * 8 + [2, 2, 3, 4]) if (it["category"] in MULTI_OK and it["price"] < 6) else 1
    unit = "dozen" if it["category"] == "eggs" else "ea"
    return q, unit, money(it["price"] * q), (f'{q} @ {it["price"]:.2f}' if q > 1 else None)

def gen_one(rid, seed):
    rng = random.Random(seed)
    r = R(rng, rid)
    n_items = rng.choice([1, 2, 3] + list(range(4, 16)) + list(range(5, 11)) * 2)
    if r.store in ("Costco", "Safeway", "Fred Meyer") and rng.random() < 0.08: n_items = rng.randint(20, 35)
    pool = CATALOG
    wrap_ok = r.store in ("Whole Foods", "Target", "Fred Meyer") and rng.random() < 0.5
    want_void = rng.random() < 0.15
    want_coupons = r.store in ("QFC", "Fred Meyer", "Safeway") and rng.random() < 0.25
    want_return = rng.random() < 0.06
    want_override = rng.random() < 0.08
    sold = []
    for k in range(n_items):
        it = rng.choice(pool)
        tax = taxable(it, r.loc)
        raw, short = store_raw(it, r.store, rng, r.W)
        if r.store == "Costco": r.features.add("costco_item_numbers")
        qty, unit, price, det = item_qty_price(r, it)
        if it["category"] == "non_food": r.features.add("non_food")
        # multibuy (Safeway style) instead of a qty detail
        if unit == "ea" and qty in (2, 3) and r.store in ("Safeway", "QFC", "Fred Meyer") and rng.random() < 0.4:
            deal = money(price * D("0.85")).quantize(D("1"), rounding=ROUND_HALF_UP) or D("1")
            raw2 = f"{qty} @ {qty} FOR {deal:.2f} {raw}"
            line = r.add(raw2, it["name"], qty, unit, deal, it["category"], tax, wrap=False)
            r.features.add("multibuy"); sold.append((line, it, tax, short)); continue
        override = None
        if want_override and not it["by_weight"] and qty == 1 and price > 1:
            new = money(price - money(rng.uniform(0.25, float(price) * 0.4)))
            override = price; price = new; r.features.add("price_override"); want_override = False
        style_before = r.store not in ("Costco",)
        if det: r.features.add("weight" if unit == "lb" else "qty_detail")
        extra = {"unit_price": float(it["price"])} if unit == "lb" or qty > 1 else {}
        if override is not None:
            extra["price_override_from"] = float(override)
            det_b = f"PRICE OVERRIDE  WAS {override:.2f}"
        else:
            det_b = det if (det and style_before) else None
        line = r.add(raw, it["name"], qty, unit, price, it["category"], tax,
                     detail_before=det_b, detail_after=(det if (det and not style_before) else None), extra=extra or None, wrap=wrap_ok)
        sold.append((line, it, tax, short))
        # void: ring the same line again then void it
        if want_void and rng.random() < 0.3:
            vdesc, vline = r.row(raw, price, r.flag(tax, it["category"]))
            r.lines.append(vline)
            _, vl = r.row("** VOID ** " + raw[:18], -price, "")
            r.lines.append(vl); r.voids.append(dict(raw_text=vdesc, price=float(price))); r.features.add("void"); want_void = False
        # deposits
        dep = LOCATIONS[r.loc]["deposit"]
        if dep and it["containers"]:
            n = it["containers"] * (qty if unit == "ea" else 1)
            per = D("0.10") if dep == "OR" or it["big_container"] else D("0.05")
            dtax = tax if dep == "CA" else False
            r.add("OR BTL DEP" if dep == "OR" else "CA CRV", "bottle deposit" if dep == "OR" else "california redemption value",
                  n, "ea", money(per * n), "deposit", dtax, line_type="deposit", detail_before=f"{n} @ {per:.2f}")
            r.features.add("deposit")
        # inline loyalty savings
        if LOYALTY[r.store] and rng.random() < 0.18 and price > 1 and not want_coupons:
            amt = -money(min(float(price) * 0.3, rng.uniform(0.2, 3.0)))
            lab = rng.choice(LOYALTY[r.store])
            if lab == "TPD/": lab = f"{rng.randint(100, 9999999):07d} TPD/{short[:12]}"
            r.add(lab, "loyalty / instant savings", 1, "ea", amt, "discount", tax, line_type="discount", extra={"applies_to": line["raw_text"]})
            r.features.add("loyalty")
    if want_return and sold:
        line, it, tax, short = rng.choice(sold)
        amt = -money(line["price"] if line["unit"] == "ea" and line["quantity"] == 1 else it["price"])
        r.add("RETURN " + line["raw_text"], it["name"], -1 if line["unit"] != "lb" else -line["quantity"], line["unit"], amt,
              it["category"], line["taxable"], line_type="return", detail_before="REFUND - ORIG RECEIPT")
        r.features.add("return")
    if want_coupons:
        cands = [x for x in sold if x[0]["price"] > 1]
        k = rng.randint(4, 12) if len(cands) >= 3 else len(cands)
        if k:
            r.lines.append(""); r.lines.append("**** COUPONS & SAVINGS ****".center(r.W).rstrip())
            tot = D("0"); used = {}
            for _ in range(k):
                l, it, t, short = rng.choice(cands)
                room = l["price"] * 0.5 - used.get(id(l), 0)
                if room < 0.25: continue
                amt = -money(min(room, rng.uniform(0.25, 3.0))); used[id(l)] = used.get(id(l), 0) + float(-amt)
                lab = rng.choice(COUPON_LABELS[r.store]) + short[:14]
                r.add(lab, "coupon", 1, "ea", amt, "discount", t, line_type="discount", extra={"applies_to": l["raw_text"]})
                tot += amt
            _, tl = r.row("TOTAL COUPONS", tot, ""); r.lines.append(tl)
            r.lines.append("************************".center(r.W).rstrip()); r.features.add("coupon_section")
    if rng.random() < 0.5 and r.store != "Costco":
        nb = rng.randint(1, 4); per = LOCATIONS[r.loc]["bag"]
        r.add("BAG FEE" if rng.random() < 0.5 else "PAPER BAG", "carryout bag charge", nb, "ea", money(per * nb), "fee",
              LOCATIONS[r.loc]["bag_taxable"], line_type="fee", detail_before=(f"{nb} @ {per:.2f}" if nb > 1 else None))
        r.features.add("bag_fee")
    # totals
    sub = sum((D(str(i["price"])) for i in r.items), D("0"))
    base = sum((D(str(i["price"])) for i in r.items if i["taxable"]), D("0"))
    tax = (base * r.rate).quantize(D("0.01"), rounding=ROUND_HALF_UP) + D("0.00")
    if tax == 0: tax = D("0.00")
    total = sub + tax
    if total <= 0: return None
    # tenders
    tenders, change = [], D("0")
    roll = rng.random()
    if roll < 0.15 and total > 5:
        gc = money(rng.uniform(1, float(total) - 0.5)); tenders = [("GIFT CARD", gc), (rng.choice(TENDERS), total - gc)]; r.features.add("split_tender")
    elif roll < 0.22 and total > 5:
        cash = money(rng.uniform(1, float(total) - 0.5)).quantize(D("1"), rounding=ROUND_HALF_UP) or D("1")
        tenders = [("CASH", cash), (rng.choice(TENDERS), total - cash)]; r.features.add("split_tender")
    elif roll < 0.35 and r.store != "Costco":
        cash = (total / 20).quantize(D("1"), rounding="ROUND_CEILING") * 20
        tenders = [("CASH", cash)]; change = cash - total; r.features.add("cash_change")
    else:
        tenders = [(rng.choice(TENDERS), total)]
    # render
    W = r.W; L = []
    n = rng.randint(1, 3999)
    for h in HEADERS[r.store]:
        L.append(h.format(n=f"{n:04d}", city=LOCATIONS[r.loc]["city"], p=f"{rng.randint(0, 9999):04d}").center(W).rstrip())
    if r.store == "Costco": L.append("MEMBER ************".center(W).rstrip())
    L.append("")
    L.extend(r.lines); L.append("")
    def rw(a, b): return a.ljust(W - len(b)) + b
    L.append(rw("SUBTOTAL", fmt(sub)))
    if r.rate == 0: L.append(rw("TAX", "0.00"))
    else: L.append(rw(f"TAX {r.rate * 100:.3f}".rstrip("0") + f"% ON {fmt(base)}", fmt(tax)))
    L.append(rw("**** TOTAL" if r.store in ("Safeway", "Costco") else "TOTAL", fmt(total)))
    for name, amt in tenders: L.append(rw(f"{name} TEND", fmt(amt)))
    L.append(rw("CHANGE", fmt(change)))
    savings = -sum((D(str(i["price"])) for i in r.items if i["line_type"] == "discount"), D("0"))
    L.append("")
    if savings > 0: L.append(rw("YOUR SAVINGS TODAY", fmt(savings)))
    count = sum((i["quantity"] if isinstance(i["quantity"], int) and i["unit"] in ("ea", "dozen") else 1)
                for i in r.items if i["line_type"] == "sale")
    L.append(f'{r.date:%m/%d/%y} {r.time}  ITEMS {count}')
    L.append(f"{r.tf}=TAXABLE" + (f"  {r.ef}=NONTAXABLE FOOD" if r.ef else ""))
    L.append("THANK YOU".center(W).rstrip())
    exp = dict(id=rid, store=r.store, location=r.loc, city=LOCATIONS[r.loc]["city"], date=r.date.isoformat(), time=r.time,
               tax_rate=float(r.rate), items=r.items, voided_lines=r.voids, subtotal=float(sub), taxable_base=float(base),
               tax=float(tax), total=float(total), tenders=[dict(type=t, amount=float(a)) for t, a in tenders], change=float(change),
               item_count=count, features=sorted(r.features), variant="clean", synthetic=True)
    return "\n".join(L) + "\n", exp

# ---------------------------------------------------------------- OCR noise
SWAP = {"0": "O", "O": "0", "1": "l", "l": "1", "I": "1", "5": "S", "S": "5", "8": "B", "B": "8", "2": "Z", "G": "6", "6": "G", "E": "F", "M": "N"}
def noisify(text, rng):
    ops, out = [], []
    for li, line in enumerate(text.split("\n")):
        new = line
        if line.strip():
            if rng.random() < 0.25:  # character swaps
                chars = list(new); idxs = [i for i, c in enumerate(chars) if c in SWAP]
                for i in rng.sample(idxs, min(len(idxs), rng.randint(1, 3))):
                    chars[i] = SWAP[chars[i]]
                new = "".join(chars); ops.append(dict(line=li, op="char_swap"))
            if rng.random() < 0.10 and "  " in new:  # dropped spaces (column gap collapses)
                new = re.sub(r" {2,}", " ", new, count=1); ops.append(dict(line=li, op="dropped_spaces"))
            if rng.random() < 0.08:  # skewed column
                k = rng.randint(1, 4)
                new = (" " * k + new) if rng.random() < 0.5 else re.sub(r" (?=\S+$)", " " * (k + 1), new, count=1)
                ops.append(dict(line=li, op="skew"))
        out.append(new)
    return "\n".join(out), ops

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=2400); ap.add_argument("--noise", type=int, default=600)
    a = ap.parse_args()
    root = os.path.join(LARGE, "receipts")
    clean_exp, noise_exp = [], []
    i = seed_i = 0
    while len(clean_exp) < a.n:
        seed_i += 1
        res = gen_one(f"R{len(clean_exp):05d}", SEED * 1000 + seed_i)
        if res is None: continue
        txt, exp = res
        shard = f"{len(clean_exp) // 100:03d}"
        rel = f"clean/{shard}/{exp['id']}_{exp['store'].lower().replace(' ', '').replace(chr(39), '')}.txt"
        os.makedirs(os.path.join(root, os.path.dirname(rel)), exist_ok=True)
        open(os.path.join(root, rel), "w").write(txt)
        exp["file"] = rel; exp["seed"] = SEED * 1000 + seed_i
        clean_exp.append((exp, txt))
    rng = random.Random(SEED + 7)
    for k, (exp, txt) in enumerate(rng.sample(clean_exp, a.noise)):
        ntxt, ops = noisify(txt, random.Random(SEED + 10000 + k))
        nid = f"N{k:05d}"
        rel = f"ocr_noise/{k // 100:03d}/{nid}_from_{exp['id']}.txt"
        os.makedirs(os.path.join(root, os.path.dirname(rel)), exist_ok=True)
        open(os.path.join(root, rel), "w").write(ntxt)
        e2 = dict(exp); e2.update(id=nid, file=rel, variant="ocr_noise", clean_ref=exp["id"], noise_ops=ops)
        noise_exp.append(e2)
    with open(os.path.join(root, "expected_clean.jsonl"), "w") as f:
        for exp, _ in clean_exp: f.write(json.dumps(exp, separators=(",", ":")) + "\n")
    with open(os.path.join(root, "expected_ocr_noise.jsonl"), "w") as f:
        for e in noise_exp: f.write(json.dumps(e, separators=(",", ":")) + "\n")
    from collections import Counter
    fc = Counter(f for e, _ in clean_exp for f in e["features"])
    print(len(clean_exp), len(noise_exp), dict(Counter(e["store"] for e, _ in clean_exp)), dict(Counter(e["location"] for e, _ in clean_exp)))
    print(dict(fc))

if __name__ == "__main__": main()
