"""Multi-receipt dedup + household cases built from fixtures/large/receipts/expected_clean.jsonl (synthetic).
The app has NO duplicate detection: public.receipts stores only (store, purchased_at date, total). The rules below are this fixture's
documented proposal; `app_key_collision` marks pairs the app's stored fields cannot tell apart.
python3 -B gen_household.py"""
from decimal import Decimal as D, ROUND_HALF_UP
from core4 import *

OUT = os.path.join(LARGE4, "household")
CONF = {"O": "0", "I": "1", "S": "5", "B": "8", "E": "F", "G": "6"}
CENT = D("0.01")
def m(x): return D(str(x)).quantize(CENT, rounding=ROUND_HALF_UP)
def f(x): return float(x)
def chain(store): return re.sub(r"[^a-z]", "", store.lower())

def parsed(rec, txn, time=True):
    """Receipt as the app would hold it (ParsedReceipt + extra printed fields the app currently drops)."""
    return dict(store=rec["store"], purchased_at=rec["date"], total=rec["total"], time=rec["time"] if time else None, transaction_id=txn,
                location=rec["city"], tax=rec["tax"], tax_rate=rec["tax_rate"],
                items=[dict(line=i, raw_name=it["raw_text"], name=it["normalized_name"], category=it["category"], quantity=it["quantity"], unit=it["unit"],
                            price=it["price"], taxable=it["taxable"], line_type=it["line_type"], **({"applies_to": it["applies_to"]} if it.get("applies_to") else {}))
                       for i, it in enumerate(rec["items"])])

def noisy(rng, p):
    q = json.loads(json.dumps(p)); q["store"] = rng.choice([p["store"], p["store"].upper(), p["store"].lower()])
    for it in q["items"]:
        if rng.random() < 0.25: it["raw_name"] = "".join(CONF.get(c, c) if rng.random() < 0.3 else c for c in it["raw_name"])
    sale = [i for i, it in enumerate(q["items"]) if it["line_type"] == "sale"]
    drop = set(rng.sample(sale, min(len(sale) - 1, rng.choice([0, 0, 0, 1, 2]))))  # OCR missed a line
    q["items"] = [it for i, it in enumerate(q["items"]) if i not in drop]
    if rng.random() < 0.3: q["time"] = None
    if rng.random() < 0.3: q["transaction_id"] = None
    return q

def names(p): return [it["name"] for it in p["items"] if it["line_type"] == "sale"]
def jaccard(a, b):
    from collections import Counter
    A, B = Counter(a), Counter(b); inter = sum((A & B).values()); uni = sum((A | B).values()); return inter / uni if uni else 1.0

def dup_rule(a, b):
    """Fixture rule. Duplicate iff same chain + same date + same total AND (same transaction id if both printed) AND
    (same time if both printed) AND (item-name multiset Jaccard >= 0.6 OR one item list is a subset of the other)."""
    if chain(a["store"]) != chain(b["store"]) or a["purchased_at"] != b["purchased_at"] or m(a["total"]) != m(b["total"]): return False, "fields_differ"
    if a["transaction_id"] and b["transaction_id"] and a["transaction_id"] != b["transaction_id"]: return False, "different_transaction_id"
    if a["time"] and b["time"] and a["time"] != b["time"]: return False, "different_time"
    na, nb = names(a), names(b); j = jaccard(na, nb)
    from collections import Counter
    sub = not (Counter(na) - Counter(nb)) or not (Counter(nb) - Counter(na))
    if j >= 0.6 or sub: return True, f"same_trip(jaccard={j:.2f}{',subset' if sub else ''})"
    return False, f"items_differ(jaccard={j:.2f})"

def txn(rng): return f"{rng.randint(1000, 9999)}-{rng.randint(10, 99)}-{rng.randint(100000, 999999)}"

def pantry_effect(receipts, dups):
    """Lots added to the pantry: sale lines of non-duplicate receipts."""
    out = []
    for k, p in enumerate(receipts):
        if k in dups: continue
        for it in p["items"]:
            if it["line_type"] == "sale": out.append(dict(receipt=k, line=it["line"], name=it["name"], quantity=it["quantity"], unit=it["unit"]))
    return out

def case_dup(rng, recs, k, kind):
    r = rng.choice(recs); a = parsed(r, txn(rng))
    if kind == "duplicate_scan": b = noisy(rng, a)
    elif kind == "partial_rescan":
        b = json.loads(json.dumps(a)); n = len(b["items"]); cut = rng.randint(max(1, n // 3), max(1, n - 1)); b["items"] = b["items"][cut:]
        b["time"] = rng.choice([a["time"], None]); b["transaction_id"] = rng.choice([a["transaction_id"], None])
    elif kind == "same_day_other_trip":           # same store & day, separate trip
        r2 = rng.choice([x for x in recs if chain(x["store"]) == chain(r["store"]) and x["id"] != r["id"]])
        b = parsed(dict(r2, date=r["date"]), txn(rng))
        h, mi = map(int, r["time"].split(":")); b["time"] = f"{(h + rng.randint(1, 5)) % 24:02d}:{mi:02d}"
    elif kind == "app_key_collision":              # identical basket bought twice the same day: same store/date/total, different trip
        b = parsed(r, txn(rng)); h, mi = map(int, r["time"].split(":")); b["time"] = f"{(h + rng.randint(1, 4)) % 24:02d}:{(mi + 7) % 60:02d}"
        if rng.random() < 0.3: b["time"] = a["time"]  # even the same minute, different register/transaction
    receipts = [a, b]; rng.shuffle(receipts) if kind != "partial_rescan" else None
    is_dup, why = dup_rule(receipts[0], receipts[1])
    dups = {1} if is_dup else set()
    app_collide = chain(receipts[0]["store"]) == chain(receipts[1]["store"]) and receipts[0]["purchased_at"] == receipts[1]["purchased_at"] and m(receipts[0]["total"]) == m(receipts[1]["total"])
    budget = sum(m(p["total"]) for i, p in enumerate(receipts) if i not in dups)
    return dict(id=f"H{k:05d}", kind=kind, source_receipts=[r["id"]], household=["member_a", "member_b"], scanned_by=[rng.choice(["member_a", "member_b"]) for _ in receipts],
                receipts=receipts, expected=dict(duplicates=[dict(receipt=1, duplicate_of=0, reason=why)] if is_dup else [], reason=why,
                                                 pantry_lots=pantry_effect(receipts, dups), budget_total=f(budget), app_key_collision=app_collide), synthetic=True)

def case_return(rng, recs, k):
    r = rng.choice([x for x in recs if sum(1 for i in x["items"] if i["line_type"] == "sale" and i["price"] > 0) >= 2])
    orig = parsed(r, txn(rng)); sales = [it for it in orig["items"] if it["line_type"] == "sale" and it["price"] > 0]
    var = rng.choices(["full_line", "partial_quantity", "over_return", "unmatched", "other_location", "no_txn_ref"], [30, 20, 10, 10, 15, 15])[0]
    by_name = {}
    for it in sales: by_name.setdefault(it["name"], it)
    picks = rng.sample(list(by_name.values()), rng.randint(1, min(3, len(by_name))))
    d0 = dt.date.fromisoformat(orig["purchased_at"]); rd = (d0 + dt.timedelta(days=rng.randint(1, 30))).isoformat()
    lines = []; refund = D(0); tax = D(0); exp_lines = []; ok = True
    for it in picks:
        q = it["quantity"]; unitp = m(it["price"]) / D(str(q)) if q else m(it["price"])
        rq = q
        if var == "partial_quantity" and isinstance(q, int) and q > 1: rq = rng.randint(1, q - 1)
        if var == "over_return": rq = (q + 1) if isinstance(q, int) else round(q + 0.5, 2)
        amt = m(unitp * D(str(rq))) if rq != q else m(it["price"])
        lines.append(dict(raw_name=it["raw_name"], name=it["name"], quantity=-rq, unit=it["unit"], price=f(-amt), taxable=it["taxable"], line_type="return"))
        # documented match rule: same name + unit + unit price (±1 cent); prefer a line whose quantity == returned quantity,
        # else the earliest line whose quantity covers it, else the earliest candidate (then it is an over-return)
        upr = amt / D(str(rq))
        cands = [s2 for s2 in sales if s2["name"] == it["name"] and s2["unit"] == it["unit"] and abs(m(s2["price"]) / D(str(s2["quantity"])) - upr) <= CENT]
        it = next((c for c in cands if c["quantity"] == rq), None) or next((c for c in cands if c["quantity"] >= rq), None) or cands[0]
        q = it["quantity"]
        over = rq > q
        if over: ok = False
        t = m(amt * D(str(orig["tax_rate"]))) if it["taxable"] else D(0)
        if not over and var != "unmatched": refund += amt; tax += t
        exp_lines.append(dict(return_line=len(lines) - 1, matched_line=None if var == "unmatched" else it["line"], returned_quantity=rq,
                              purchased_quantity=q, status="rejected_over_return" if over else ("unmatched" if var == "unmatched" else "accepted"),
                              refund=f(0 if over or var == "unmatched" else amt), refund_tax=f(0 if over or var == "unmatched" else t),
                              pantry=None if over or var == "unmatched" else dict(name=it["name"], quantity_delta=-rq, removes_lot=(rq == q))))
    if var == "partial_quantity" and all(e["returned_quantity"] == e["purchased_quantity"] for e in exp_lines): var = "full_line"
    store = orig["store"]; loc = orig["location"] if var != "other_location" else rng.choice(["Bellevue WA", "Tacoma WA", "Portland OR", "Redmond WA"])
    ref = None if var in ("no_txn_ref", "unmatched") else orig["transaction_id"]
    printed_total = -sum(m(-l["price"]) for l in lines) - sum(m(m(-l["price"]) * D(str(orig["tax_rate"]))) for l in lines if l["taxable"])
    ret = dict(store=store, purchased_at=rd, total=f(printed_total), time=f"{rng.randint(9, 20):02d}:{rng.randint(0, 59):02d}", transaction_id=txn(rng),
               location=loc, tax=f(-sum(m(m(-l["price"]) * D(str(orig["tax_rate"]))) for l in lines if l["taxable"])), tax_rate=orig["tax_rate"],
               original_transaction_ref=ref, original_date_printed=orig["purchased_at"] if var != "unmatched" else None,
               items=[dict(line=i, **l) for i, l in enumerate(lines)])
    receipts = [orig, ret]
    if var == "unmatched":   # the original is not in the household's receipts: replace with another trip from that chain
        other = rng.choice([x for x in recs if x["id"] != r["id"]]); receipts = [parsed(other, txn(rng)), ret]
    match_rule = ("transaction_id" if ref else "chain+item name+unit price, original within 90 days before the return")
    return dict(id=f"H{k:05d}", kind="return_reference", variant=var, source_receipts=[r["id"]], household=["member_a", "member_b"],
                receipts=receipts, expected=dict(return_receipt=1, original_receipt=None if var == "unmatched" else 0, match_rule=match_rule,
                                                 lines=exp_lines, refund_total=f(refund + tax), printed_total=f(printed_total), all_accepted=ok and var != "unmatched"),
                synthetic=True)

def largest_remainder(total_cents, weights):
    """Split integer cents proportionally to weights; leftover cents go to the largest fractional parts (ties: earlier member)."""
    tw = sum(weights)
    if tw == 0: weights = [1] * len(weights); tw = len(weights)
    raw = [D(total_cents) * D(w) / D(tw) for w in weights]; base = [int(x) if x >= 0 else -int(-x) for x in raw]
    left = total_cents - sum(base); order = sorted(range(len(raw)), key=lambda i: (-(raw[i] - base[i]) if left >= 0 else (raw[i] - base[i]), i))
    for i in order[:abs(left)]: base[i] += 1 if left >= 0 else -1
    return base

def case_split(rng, recs, k):
    r = rng.choice(recs); p = parsed(r, txn(rng)); n = rng.choice([2, 2, 3, 4]); members = [f"member_{c}" for c in "abcd"[:n]]
    mode = rng.choice(["even", "by_item", "by_item", "percent"])
    total_c = int(m(p["total"]) * 100)
    if mode == "even":
        alloc = largest_remainder(total_c, [1] * n); assign = None; rule = "total split evenly; leftover cents to earliest members"
    elif mode == "percent":
        pct = sorted(rng.sample(range(5, 95, 5), n - 1)); pc = [b - a for a, b in zip([0] + pct, pct + [100])]
        alloc = largest_remainder(total_c, pc); assign = dict(percent=dict(zip(members, pc))); rule = "total split by percent with largest-remainder cents"
    else:
        sale_owner = {}
        for it in p["items"]:
            if it["line_type"] == "sale": sale_owner[it["line"]] = rng.choice(members + ["shared"])
        owner = {}; last_sale = None
        for it in p["items"]:
            if it["line_type"] == "sale": owner[it["line"]] = sale_owner[it["line"]]; last_sale = it
            elif it["line_type"] == "discount" and it.get("applies_to"):
                tgt = next((s for s in p["items"] if s["line_type"] == "sale" and s["raw_name"] == it["applies_to"]), None)
                owner[it["line"]] = owner.get(tgt["line"], "shared") if tgt else "shared"
            elif it["line_type"] == "deposit" and last_sale: owner[it["line"]] = owner[last_sale["line"]]
            else: owner[it["line"]] = "shared"
        per = {mm: 0 for mm in members}; taxable = {mm: 0 for mm in members}
        for it in p["items"]:
            c = int(m(it["price"]) * 100); o = owner[it["line"]]
            shares = largest_remainder(c, [1] * n) if o == "shared" else [c if mm == o else 0 for mm in members]
            for mm, sh in zip(members, shares):
                per[mm] += sh
                if it["taxable"]: taxable[mm] += sh
        tax_c = int(m(p["tax"]) * 100); tx = largest_remainder(tax_c, [max(taxable[mm], 0) for mm in members])
        alloc = [per[mm] + t for mm, t in zip(members, tx)]; assign = dict(line_owner={str(kk): v for kk, v in owner.items()}, tax_allocation=dict(zip(members, [t / 100 for t in tx])))
        rule = "lines to their owner (discounts follow the item they apply to, deposits follow the preceding item, shared lines split evenly); tax by each member's taxable amount; largest-remainder cents"
    assert sum(alloc) == total_c
    return dict(id=f"H{k:05d}", kind="split_bill", mode=mode, source_receipts=[r["id"]], household=members, receipts=[p],
                assignment=assign, expected=dict(per_member={mm: a / 100 for mm, a in zip(members, alloc)}, sum_equals_total=True, rule=rule), synthetic=True)

PLAN = [("duplicate_scan", 300), ("partial_rescan", 100), ("same_day_other_trip", 150), ("app_key_collision", 100), ("return_reference", 450), ("split_bill", 400)]
def main():
    rng = random.Random(SEED4 + 500_000)
    recs = [json.loads(l) for l in open(os.path.join(FIXDIR, "large", "receipts", "expected_clean.jsonl"))]
    rows = []
    for kind, n in PLAN:
        for _ in range(n):
            k = len(rows)
            rows.append(case_return(rng, recs, k) if kind == "return_reference" else case_split(rng, recs, k) if kind == "split_bill" else case_dup(rng, recs, k, kind))
    jdump(os.path.join(OUT, "cases.jsonl"), rows)
    from collections import Counter
    print(len(rows), Counter((r["kind"], bool(r["expected"].get("duplicates"))) for r in rows if "duplicates" in r["expected"]),
          Counter(r.get("variant") for r in rows if r["kind"] == "return_reference"), Counter(r.get("mode") for r in rows if r["kind"] == "split_bill"),
          sum(1 for r in rows if r["expected"].get("app_key_collision") and not r["expected"]["duplicates"]))

if __name__ == "__main__": main()
