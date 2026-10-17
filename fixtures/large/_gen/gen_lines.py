"""20k+ labeled synthetic receipt lines (JSONL, sharded). python3 gen_lines.py [--n 24000]"""
import os, json, random, argparse
from decimal import Decimal as D
from common import *
from gen_receipts import FLAGS, LOYALTY, item_qty_price, SWAP

class Dummy: pass

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=24000); ap.add_argument("--shard", type=int, default=8000)
    a = ap.parse_args(); rng = random.Random(SEED + 2)
    out = os.path.join(LARGE, "receipt_lines"); os.makedirs(out, exist_ok=True)
    rows = []
    while len(rows) < a.n:
        store = STORES[len(rows) % 7]; loc = pick_weighted(rng, STORE_LOCATIONS[store])
        it = rng.choice(CATALOG); raw, short = store_raw(it, store, rng)
        d = Dummy(); d.rng = rng
        qty, unit, price, det = item_qty_price(d, it)
        base = dict(store=store, location=loc, normalized_name=it["name"], quantity=qty, unit=unit, category=it["category"],
                    taxable=taxable(it, loc), observed=False, synthetic=True)
        kind = rng.random()
        if kind < 0.62:
            rows.append(dict(base, raw_text=raw, price=float(price), line_type="sale"))
        elif kind < 0.72 and det:
            rows.append(dict(base, raw_text=det, price=float(price), line_type="weight_detail" if unit == "lb" else "qty_detail",
                             unit_price=float(it["price"]), detail_of=raw))
        elif kind < 0.76 and store in ("Safeway", "QFC", "Fred Meyer"):
            q = rng.choice([2, 3, 4]); deal = (it["price"] * q * D("0.85")).quantize(D("1")) or D("1")
            rows.append(dict(base, raw_text=f"{q} @ {q} FOR {deal:.2f} {raw}", quantity=q, unit="ea", price=float(deal), line_type="multibuy"))
        elif kind < 0.84:
            labs = LOYALTY[store] or ["SC "]
            lab = rng.choice(labs); lab = f"{rng.randint(100, 9999999):07d} TPD/{short[:12]}" if lab == "TPD/" else (lab + (" " + short[:14] if rng.random() < 0.5 else ""))
            rows.append(dict(base, raw_text=lab.strip(), normalized_name="discount", quantity=1, unit="ea", price=-float(money(rng.uniform(0.2, 4))),
                             category="discount", line_type="discount", applies_to=it["name"]))
        elif kind < 0.87:
            rows.append(dict(base, raw_text="RETURN " + raw, quantity=-qty, price=-float(price), line_type="return"))
        elif kind < 0.89:
            rows.append(dict(base, raw_text="** VOID ** " + raw[:18], price=-float(price), line_type="void", voids=raw))
        elif kind < 0.92:
            dep = LOCATIONS[loc]["deposit"] or rng.choice(["OR", "CA"]); loc2 = "OR" if dep == "OR" else "CA"
            n = rng.choice([1, 2, 6, 12, 24]); per = D("0.10") if dep == "OR" or rng.random() < 0.3 else D("0.05")
            rows.append(dict(base, location=loc2, raw_text="OR BTL DEP" if dep == "OR" else "CA CRV", normalized_name="bottle deposit",
                             quantity=n, unit="ea", price=float(per * n), category="deposit", taxable=False, line_type="deposit",
                             note="taxable in CA only when the beverage is taxable; set false here (unknown beverage)"))
        elif kind < 0.94:
            n = rng.randint(1, 4); per = LOCATIONS[loc]["bag"]
            rows.append(dict(base, raw_text=rng.choice(["BAG FEE", "PAPER BAG", "BAG CHARGE", "CARRYOUT BAG"]), normalized_name="carryout bag charge",
                             quantity=n, unit="ea", price=float(per * n), category="fee", taxable=LOCATIONS[loc]["bag_taxable"], line_type="fee"))
        else:  # ocr-noised sale line with clean label
            chars = list(raw); idx = [i for i, c in enumerate(chars) if c in SWAP]
            for i in rng.sample(idx, min(len(idx), rng.randint(1, 2))): chars[i] = SWAP[chars[i]]
            noisy = "".join(chars)
            if noisy == raw: continue
            rows.append(dict(base, raw_text=noisy, clean_text=raw, price=float(price), line_type="sale", ocr_noise=True))
    for i, r in enumerate(rows): r["id"] = f"L{i:06d}"
    for s in range(0, len(rows), a.shard):
        with open(os.path.join(out, f"lines_{s // a.shard:03d}.jsonl"), "w") as f:
            for r in rows[s:s + a.shard]: f.write(json.dumps(r, separators=(",", ":")) + "\n")
    from collections import Counter
    print(len(rows), Counter(r["line_type"] for r in rows), Counter(r["store"] for r in rows))

if __name__ == "__main__": main()
