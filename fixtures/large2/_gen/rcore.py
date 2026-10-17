"""Shared core for fixtures/large2 generators. Reuses batch-1 building blocks from ../../large/_gen READ-ONLY
(no bytecode is written there). Shelf-life / allergen data are only read from ../../shelf_life.json and allergens.json."""
import sys, os, re, json, random, datetime as dt
sys.dont_write_bytecode = True
GEN2 = os.path.dirname(os.path.abspath(__file__)); LARGE2 = os.path.dirname(GEN2); FIXDIR = os.path.dirname(LARGE2)
sys.path.insert(0, os.path.join(FIXDIR, "large", "_gen"))
from common import *            # noqa: E402,F401  (SEED, CATALOG, LOCATIONS, taxable, store_raw, money, CATS, SHELF, ...)
import gen_receipts as G        # noqa: E402  (R row/add helpers, FLAGS, HEADERS, TENDERS, LOYALTY, item_qty_price)
from decimal import Decimal as D, ROUND_HALF_UP
SEED2 = SEED + 2_000_000        # batch-2 base seed; each set adds its own offset

NONFOOD_POOL = [c for c in CATALOG if c["category"] == "non_food"]
FOOD_POOL = [c for c in CATALOG if c["category"] != "non_food"]

def jdump(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for r in rows: f.write(json.dumps(r, separators=(",", ":")) + "\n")

def fmt(x): return G.fmt(x)

def new_receipt(rng, rid, store=None, loc=None, date=None):
    r = G.R(rng, rid)
    if store:
        r.store = store; r.loc = loc or pick_weighted(rng, STORE_LOCATIONS[store]); r.rate = LOCATIONS[r.loc]["rate"]
        r.W = G.WIDTH.get(store, 40); r.tf, r.ef = G.FLAGS[store]
    elif loc:
        r.loc = loc; r.rate = LOCATIONS[loc]["rate"]
    if date: r.date = date
    return r

def add_tracked(r, *a, **k):
    it = r.add(*a, **k)
    it["_line"] = len(r.lines) - 1 - (1 if k.get("detail_after") else 0)
    return it

def fill_items(r, n_items, mode="normal", repeat_legit=False, loyalty=True, bag=True):
    """mode: normal | non_food | returns. Returns list of sold item dicts."""
    rng = r.rng; pool = NONFOOD_POOL if mode == "non_food" else CATALOG
    for k in range(n_items):
        it = rng.choice(pool); tax = taxable(it, r.loc)
        raw, short = store_raw(it, r.store, rng, r.W)
        if r.store == "Costco": r.features.add("costco_item_numbers")
        if mode == "returns":
            qty, unit, price, det = G.item_qty_price(r, it)
            add_tracked(r, "RETURN " + raw, it["name"], -qty, unit, -price, it["category"], tax, line_type="return",
                        detail_before="REFUND - ORIG RECEIPT" if k == 0 or rng.random() < 0.3 else None)
            r.features.add("return"); continue
        qty, unit, price, det = G.item_qty_price(r, it)
        extra = {"unit_price": float(it["price"])} if unit == "lb" or qty > 1 else None
        before = det if (det and r.store != "Costco") else None
        after = det if (det and r.store == "Costco") else None
        line = add_tracked(r, raw, it["name"], qty, unit, price, it["category"], tax, detail_before=before, detail_after=after, extra=extra)
        if det: r.features.add("weight" if unit == "lb" else "qty_detail")
        if it["category"] == "non_food": r.features.add("non_food")
        if repeat_legit and k == n_items // 2:
            add_tracked(r, raw, it["name"], qty, unit, price, it["category"], tax, detail_before=before, detail_after=after, extra=extra)
            r.features.add("legit_repeat")
        dep = LOCATIONS[r.loc]["deposit"]
        if dep and it["containers"]:
            n = it["containers"] * (qty if unit == "ea" else 1)
            per = D("0.10") if dep == "OR" or it["big_container"] else D("0.05")
            add_tracked(r, "OR BTL DEP" if dep == "OR" else "CA CRV", "bottle deposit" if dep == "OR" else "california redemption value",
                        n, "ea", money(per * n), "deposit", tax if dep == "CA" else False, line_type="deposit", detail_before=f"{n} @ {per:.2f}")
            r.features.add("deposit")
        if loyalty and G.LOYALTY[r.store] and rng.random() < 0.15 and price > 1:
            amt = -money(min(float(price) * 0.3, rng.uniform(0.2, 3.0))); lab = rng.choice(G.LOYALTY[r.store])
            if lab == "TPD/": lab = f"{rng.randint(100, 9999999):07d} TPD/{short[:12]}"
            add_tracked(r, lab, "loyalty / instant savings", 1, "ea", amt, "discount", tax, line_type="discount", extra={"applies_to": line["raw_text"]})
            r.features.add("loyalty")
    if bag and mode != "returns" and r.store != "Costco" and rng.random() < 0.4:
        nb = rng.randint(1, 3); per = LOCATIONS[r.loc]["bag"]
        add_tracked(r, "BAG FEE", "carryout bag charge", nb, "ea", money(per * nb), "fee", LOCATIONS[r.loc]["bag_taxable"], line_type="fee",
                    detail_before=(f"{nb} @ {per:.2f}" if nb > 1 else None))
        r.features.add("bag_fee")

def totals(r, tax_exempt=False):
    sub = sum((D(str(i["price"])) for i in r.items), D("0"))
    base = sum((D(str(i["price"])) for i in r.items if i["taxable"]), D("0"))
    tax = D("0.00") if tax_exempt else (base * r.rate).quantize(D("0.01"), rounding=ROUND_HALF_UP)
    if tax == 0: tax = D("0.00")
    return sub, base, tax, sub + tax

def date_line(r, count):
    return f'{r.date:%m/%d/%y} {r.time}  ITEMS {count}'

def render(r, *, tax_exempt=False, printed=None, header_extra=(), footer_extra=(), legend=None, date_line_text=None, tender=None):
    """Return (text, expected, item_offset). printed: dict overriding printed subtotal/tax/total (store errors)."""
    rng = r.rng; W = r.W
    sub, base, tax, total = totals(r, tax_exempt)
    pr = dict(subtotal=sub, tax=tax, total=total); pr.update(printed or {})
    charge = pr["total"]
    if tender: tenders, change = tender(charge)
    elif charge < 0: tenders, change = [(rng.choice(G.TENDERS), charge)], D("0")
    elif rng.random() < 0.15 and r.store != "Costco":
        cash = (charge / 20).quantize(D("1"), rounding="ROUND_CEILING") * 20
        if cash == charge: cash += 20
        tenders, change = [("CASH", cash)], cash - charge
    else: tenders, change = [(rng.choice(G.TENDERS), charge)], D("0")
    L = []; n = rng.randint(1, 3999)
    for h in G.HEADERS[r.store]:
        L.append(h.format(n=f"{n:04d}", city=LOCATIONS[r.loc]["city"], p=f"{rng.randint(0, 9999):04d}").center(W).rstrip())
    if r.store == "Costco": L.append("MEMBER ************".center(W).rstrip())
    L.extend(header_extra)
    if tax_exempt: L.append(f"TAX EXEMPT ID ******{rng.randint(1000, 9999)}")
    L.append("")
    off = len(L)
    L.extend(r.lines); L.append("")
    def rw(a, b): return a.ljust(W - len(b)) + b
    L.append(rw("SUBTOTAL", fmt(pr["subtotal"])))
    if tax_exempt: L.append(rw("TAX EXEMPT", fmt(pr["tax"])))
    elif r.rate == 0: L.append(rw("TAX", fmt(pr["tax"])))
    else: L.append(rw(f"TAX {r.rate * 100:.3f}".rstrip("0") + f"% ON {fmt(base)}", fmt(pr["tax"])))
    L.append(rw("**** TOTAL" if r.store in ("Safeway", "Costco") else "TOTAL", fmt(pr["total"])))
    for name, amt in tenders: L.append(rw(f"{name} TEND", fmt(amt)))
    L.append(rw("CHANGE", fmt(change)))
    L.append("")
    count = sum((i["quantity"] if isinstance(i["quantity"], int) and i["unit"] in ("ea", "dozen") else 1)
                for i in r.items if i["line_type"] == "sale")
    L.append(date_line_text or date_line(r, count))
    L.append(legend or (f"{r.tf}=TAXABLE" + (f"  {r.ef}=NONTAXABLE FOOD" if r.ef else "")))
    L.extend(footer_extra)
    L.append("THANK YOU".center(W).rstrip())
    items = []
    for i in r.items:
        i = dict(i); i["_line"] = i["_line"] + off; items.append(i)
    exp = dict(store=r.store, location=r.loc, city=LOCATIONS[r.loc]["city"], date=r.date.isoformat(), time=r.time,
               tax_rate=float(r.rate), items=items, subtotal=float(sub), taxable_base=float(base), tax=float(tax), total=float(total),
               printed=dict(subtotal=float(pr["subtotal"]), tax=float(pr["tax"]), total=float(pr["total"])),
               tenders=[dict(type=t, amount=float(a)) for t, a in tenders], change=float(change), item_count=count,
               tax_exempt=tax_exempt, features=sorted(r.features), synthetic=True)
    return "\n".join(L) + "\n", exp

def strip_internal(items):
    return [{k: v for k, v in i.items() if not k.startswith("_")} for i in items]
