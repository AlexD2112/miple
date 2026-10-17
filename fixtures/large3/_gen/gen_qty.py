"""Quantity / unit parsing cases: printed receipt line(s) -> quantity, unit, unit_price, gross_total, discount_total, line_total,
pack, deal, and the app ParsedReceipt-style (quantity, unit). Rules in README "Quantity rules". python3 gen_qty.py [--n 10000]"""
import argparse
from core3 import *

def m2(x): return D(str(x)).quantize(D("0.01"), rounding=ROUND_HALF_UP)
def f(x): return f"{m2(x):.2f}"
def num(x): return float(x) if not isinstance(x, int) else x
SIZES = [("5OZ", 5, "oz"), ("16 OZ", 16, "oz"), ("64 FL OZ", 64, "fl oz"), ("52FL OZ", 52, "fl oz"), ("0.5 GAL", 0.5, "gal"), ("1/2 GAL", 0.5, "gal"),
         ("1 GAL", 1, "gal"), ("12 CT", 12, "ct"), ("18CT", 18, "ct"), ("1.75L", 1.75, "l"), ("2 LB", 2, "lb"), ("1LB", 1, "lb"), ("32OZ", 32, "oz"),
         ("1 EA", 1, "ea"), ("8 OZ", 8, "oz"), ("10.5OZ", 10.5, "oz"), ("750ML", 750, "ml"), ("6 CT", 6, "ct")]
PACKS = [("40PK", 40, None, None), ("24PK", 24, None, None), ("12PK 12OZ", 12, 12, "fl oz"), ("24/16.9OZ", 24, 16.9, "fl oz"), ("2/24CT", 2, 24, "ct"),
         ("3/1LB", 3, 1, "lb"), ("8PK", 8, None, None), ("6/8OZ", 6, 8, "oz")]
S = {t[0]: t for t in SIZES}; PK = {t[0]: t for t in PACKS}
SIZE_BY_CAT = {"beverages": ["64 FL OZ", "52FL OZ", "1.75L", "0.5 GAL", "1/2 GAL", "1 GAL", "750ML", "32OZ"], "milk": ["0.5 GAL", "1/2 GAL", "1 GAL", "64 FL OZ"],
               "eggs": ["12 CT", "18CT", "6 CT"], "non_food": ["1 EA", "12 CT", "6 CT"], "leafy greens": ["5OZ", "16 OZ", "1 EA"], "berries": ["16 OZ", "1LB", "2 LB"],
               "root vegetables": ["2 LB", "1LB"], "fresh herbs": ["1 EA"], "other fresh fruit": ["2 LB", "1LB", "1 EA"]}
PACK_BY_CAT = {"beverages": ["12PK 12OZ", "24/16.9OZ", "24PK", "8PK", "6/8OZ"], "eggs": ["2/24CT"], "non_food": ["40PK", "24PK", "8PK"],
               "root vegetables": ["3/1LB"], "snacks": ["8PK", "6/8OZ"], "yogurt": ["6/8OZ", "8PK"]}
TYPES = [("unit_single", 8), ("qty_at", 12), ("weight", 14), ("deal_n_for", 10), ("bogo", 6), ("pack", 8), ("size_in_name", 12), ("upc_embedded", 6),
         ("plu_weight", 6), ("costco_tpd", 6), ("n_ea", 4), ("rounding_edge", 8)]
def upc_check(d11):
    s = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(d11)); return str((10 - s % 10) % 10)

def make(rng, k):
    typ = rng.choices([t for t, _ in TYPES], [w for _, w in TYPES])[0]
    pool = [c for c in CATALOG if (c["by_weight"] if typ in ("weight", "plu_weight", "rounding_edge", "upc_embedded") else not c["by_weight"])]
    if typ in ("pack", "size_in_name", "costco_tpd"): pool = [c for c in pool if not re.search(r"\d|pack|\bct\b|\boz\b|gallon|\bcans?\b", c["name"], re.I)]
    if typ == "pack": pool = [c for c in pool if c["category"] in PACK_BY_CAT]
    if typ == "deal_n_for": pool = [c for c in pool if c["price"] < 6 and c["category"] != "non_food"]
    it = rng.choice(pool); store = "Costco" if typ == "costco_tpd" else rng.choice(STORES)
    raw, short = store_raw(it, store, rng); raw = re.sub(r"\s+\d+(\.\d+)?\s*(OZ|LB|CT|PK|GAL|FL OZ)\b.*$", "", raw)
    price = it["price"]; e = dict(pack=None, deal=None, size=None, discount_total=0.0, weight_embedded=None)
    lines = []
    if typ == "unit_single":
        lines = [f"{raw}  {f(price)}"]; q, u, up, gross = 1, "ea", price, price
    elif typ in ("qty_at", "n_ea"):
        q = rng.randint(2, 6); fmt = rng.choice(["{q} @ {p}", "{q} @ {p} EA", "QTY {q} @ {p}", "{q} X {p}", "{q} @ ${p}"]) if typ == "qty_at" else rng.choice(["{q} EA @ {p}", "{q} EA @ {p} EA"])
        lines = [fmt.format(q=q, p=f(price)), f"{raw}  {f(price * q)}"]; u, up, gross = "ea", price, m2(price * q)
    elif typ in ("weight", "rounding_edge", "plu_weight"):
        unit = "kg" if rng.random() < 0.05 else "lb"
        if typ == "rounding_edge":
            for _ in range(500):  # weight x price lands exactly on a half cent
                w = D(rng.randint(5, 600)) / 100; p = D(rng.randint(99, 1999)) / 100
                if (w * p * 1000) % 10 == 5: break
        else:
            w = D(rng.randint(20, 650)) / 100 if unit == "lb" else D(rng.randint(100, 2500)) / 1000; p = price
        gross = m2(w * p); U = unit.upper()
        fmt = rng.choice([f"{w:.2f} lb @ {p:.2f} /lb", f"{w:.2f} LB @ ${p:.2f}/LB", f"{w:.2f}lb@{p:.2f}/lb", f"NET WT {w:.2f} LB @ {p:.2f}/LB",
                          f"{w:.2f} @ {p:.2f}/LB", f"WT {w:.2f} LB  @ {p:.2f} /LB"]) if unit == "lb" else f"{w:.3f} kg @ {p:.2f}/kg"
        name = raw if typ != "plu_weight" else f"PLU {rng.randint(3000, 4999)} {short}"
        lines = [fmt, f"{name}  {f(gross)}"]; q, u, up = w, unit, p
    elif typ == "deal_n_for":
        n = rng.choice([2, 3, 4, 5, 10]); dp = m2(max(D("1"), (price * n * D("0.8")).quantize(D("1"))))
        q = rng.choice([n, n, 1, n + 1, 2 * n] if n > 1 else [n])
        per = m2(dp / n); gross = m2((q // n) * dp + (q % n) * per)
        fmt = rng.choice([f"{q} @ {n}/${dp:.2f}", f"{q} @ {n} FOR {dp:.2f}", f"{q} @ {n}/{dp:.2f}"])
        lines = [fmt, f"{raw}  {f(gross)}"]; u, up = "ea", per; e["deal"] = dict(n=n, price=float(dp), per_unit=float(per))
    elif typ == "bogo":
        kind = rng.choice(["free", "free", "50"])
        disc = price if kind == "free" else m2(price * D("0.5"))
        lab = rng.choice(["BOGO FREE", "B1G1 FREE", "BUY 1 GET 1"]) if kind == "free" else rng.choice(["BOGO 50% OFF", "B1G1 50%"])
        lines = [f"{raw}  {f(price)}", f"{raw}  {f(price)}", f"{lab}  {f(disc)}-"]
        q, u, up, gross = 2, "ea", price, m2(price * 2); e["discount_total"] = float(disc); e["deal"] = dict(type="bogo_" + kind, discount=float(disc))
    elif typ == "pack":
        tok, cnt, sz, su = PK[rng.choice(PACK_BY_CAT[it["category"]])]; lines = [f"{raw} {tok}  {f(price)}"]; q, u, up, gross = 1, "ea", price, price
        e["pack"] = dict(count=cnt, size=sz, size_unit=su)
    elif typ == "size_in_name":
        tok, sv, su = S[rng.choice(SIZE_BY_CAT.get(it["category"], ["8 OZ", "16 OZ", "32OZ", "10.5OZ", "1 EA", "2 LB"]))]; c = rng.choice([1, 1, 1, 2, 3])
        if c == 1: lines = [f"{raw} {tok}  {f(price)}"]; gross = price
        else: lines = [f"{c} @ {f(price)}", f"{raw} {tok}  {f(price * c)}"]; gross = m2(price * c)
        q, u, up = c, "ea", price; e["size"] = dict(value=sv, unit=su)
    elif typ == "upc_embedded":
        item = f"{rng.randint(0, 99999):05d}"; cents = rng.randint(150, 4999); d11 = "2" + item + f"{cents:05d}"
        code = d11 + upc_check(d11); gross = m2(D(cents) / 100)
        lines = [f"{raw}  {f(gross)}", f"  {code[0]} {code[1:6]} {code[6:11]} {code[11]}"]; q, u, up = 1, "ea", None
        e["weight_embedded"] = dict(upc=code, format="2-IIIII-PPPPP-C (price in cents, no price check digit)", embedded_price=float(gross))
    elif typ == "costco_tpd":
        num_ = rng.randint(1000, 1999999); tok, sv, su = rng.choice([("3LB", 3, "lb"), ("2/24CT", None, None), ("40PK", None, None), ("48 OZ", 48, "oz"), ("", None, None)])
        disc = m2(min(price * D("0.4"), D(rng.choice(["1.00", "2.00", "3.00", "4.00", "5.00"]))))
        lines = [f"{num_} {raw.split(' ', 1)[-1]} {tok}".rstrip() + f"  {f(price)}", f"{num_} TPD/{short[:12]}  {f(disc)}-"]
        q, u, up, gross = 1, "ea", price, price; e["discount_total"] = float(disc)
        if tok == "2/24CT": e["pack"] = dict(count=2, size=24, size_unit="ct")
        elif tok == "40PK": e["pack"] = dict(count=40, size=None, size_unit=None)
        elif sv: e["size"] = dict(value=sv, unit=su)
    line_total = m2(gross) - m2(e["discount_total"])
    # app ParsedReceipt-style quantity/unit (schemas.ts example: "ORG SPNCH 5OZ" -> quantity 5, unit "oz")
    if u in ("lb", "kg"): aq, au = num(q), u
    elif e["pack"]: aq = q * e["pack"]["count"] * (e["pack"]["size"] if e["pack"]["size_unit"] == "ct" else 1); au = "ct"
    elif e["size"] and e["size"]["unit"] != "ea": aq = float(m2(D(str(e["size"]["value"])) * q)) if q != 1 else e["size"]["value"]; au = e["size"]["unit"]
    elif q == 1: aq, au = 1, None
    else: aq, au = q, "ea"
    return dict(id=f"Q{k:05d}", store=store, pricing_type=typ, lines=lines, normalized_name=it["name"], category=it["category"],
                expected=dict(quantity=num(q), unit=u, unit_price=None if up is None else float(m2(up)), gross_total=float(m2(gross)),
                              discount_total=e["discount_total"], line_total=float(line_total), pack=e["pack"], size=e["size"], deal=e["deal"],
                              weight_embedded=e["weight_embedded"], app_quantity=aq if not isinstance(aq, D) else float(aq), app_unit=au),
                synthetic=True, observed=False)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=10000); a = ap.parse_args()
    rng = random.Random(SEED3 + 300_000); rows = [make(rng, k) for k in range(a.n)]
    jdump(os.path.join(LARGE3, "quantity_parsing", "cases.jsonl"), rows)
    from collections import Counter
    print(len(rows), Counter(r["pricing_type"] for r in rows))
    for r in rows[:12]: print(r["lines"], {k: r["expected"][k] for k in ("quantity", "unit", "unit_price", "line_total", "app_quantity", "app_unit")})

if __name__ == "__main__": main()
