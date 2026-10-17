"""Unit conversion + pantry quantity normalization. Constants are exact by definition (no measured values):
  1 lb = 0.45359237 kg (international avoirdupois pound, 1959); 1 oz = 1/16 lb; 1 US gal = 231 in^3 = 3.785411784 L;
  1 US fl oz = 1/128 US gal; qt = 1/4 gal; pt = 1/8 gal; US customary cup = 1/16 gal; tbsp = 1/2 fl oz; tsp = 1/6 fl oz; dozen = 12.
Arithmetic is exact (fractions). `stored` = value as the app's items.quantity numeric(10,2) column keeps it (round half away from zero).
python3 -B gen_units.py"""
from fractions import Fraction as F
from decimal import Decimal, ROUND_HALF_UP
from core4 import *

OUT = os.path.join(LARGE4, "unit_conversion")
LB = F(45359237, 100000)            # grams
GAL = F(3785411784, 1000000)         # millilitres
UNITS = {  # canonical unit -> (dimension, size in base unit: g | mL | ct)
    "g": ("mass", F(1)), "kg": ("mass", F(1000)), "mg": ("mass", F(1, 1000)), "lb": ("mass", LB), "oz": ("mass", LB / 16),
    "ml": ("volume", F(1)), "l": ("volume", F(1000)), "gal": ("volume", GAL), "qt": ("volume", GAL / 4), "pt": ("volume", GAL / 8),
    "cup": ("volume", GAL / 16), "fl oz": ("volume", GAL / 128), "tbsp": ("volume", GAL / 256), "tsp": ("volume", GAL / 768),
    "ct": ("count", F(1)), "ea": ("count", F(1)), "dozen": ("count", F(12)),
}
BASE = {"mass": "g", "volume": "ml", "count": "ct"}
ALIASES = {"g": ["G", "g", "GR", "GRM", "grams"], "kg": ["KG", "kg", "Kg", "KGS"], "mg": ["MG", "mg"], "lb": ["LB", "lb", "LBS", "lbs", "#", "Lb"],
           "oz": ["OZ", "oz", "Oz", "OZS", "ounce"], "ml": ["ML", "ml", "mL", "MLS"], "l": ["L", "l", "LTR", "LT", "liter", "litre"],
           "gal": ["GAL", "GA", "gal", "gallon"], "qt": ["QT", "qt", "quart"], "pt": ["PT", "pt", "pint"], "cup": ["cup", "cups", "C"],
           "fl oz": ["FL OZ", "FLOZ", "FZ", "fl oz", "fl. oz.", "FL. OZ", "oz fl"], "tbsp": ["tbsp", "TBSP", "Tbsp", "T"], "tsp": ["tsp", "TSP", "t"],
           "ct": ["CT", "ct", "COUNT", "PC", "PCS"], "ea": ["EA", "ea", "EACH"], "dozen": ["DZ", "DOZ", "dozen", "DOZEN"]}
UNKNOWN = ["BNCH", "BUNCH", "BAG", "BX", "CAN", "JAR", "SLEEVE", "HEAD"]
def canon(raw):
    for k, v in ALIASES.items():
        if raw in v: return k
    return None
def exact(x): return f"{x.numerator}/{x.denominator}" if x.denominator != 1 else str(x.numerator)
def rnd(x, places):
    return float((Decimal(x.numerator) / Decimal(x.denominator)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP)) if True else None
def dec(x, places=6):
    from decimal import getcontext; getcontext().prec = 60
    return float((Decimal(x.numerator) / Decimal(x.denominator)).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))
def conv(q, u_from, u_to):
    d1, s1 = UNITS[u_from]; d2, s2 = UNITS[u_to]
    if d1 != d2: return None
    return q * s1 / s2
def val(x): return dict(exact=exact(x), value=dec(x, 6), stored=dec(x, 2))

REAL = {  # realistic package/pantry quantities per unit (synthetic choices, not measurements)
    "g": [100, 125, 150, 200, 227, 250, 340, 454, 500, 680, 907, 1000], "kg": [0.25, 0.5, 0.75, 1, 1.2, 1.5, 2, 2.27, 2.5, 5],
    "mg": [500, 750, 1000, 2500], "lb": [0.25, 0.5, 0.75, 1, 1.25, 1.32, 1.5, 2, 2.5, 3, 4.2, 5, 10], "oz": [1, 2, 3, 4, 5, 6, 8, 10, 12, 14.5, 16, 24, 32],
    "ml": [100, 236, 250, 330, 355, 473, 500, 750, 946, 1000, 1890], "l": [0.5, 1, 1.5, 1.75, 2, 3, 4], "gal": [0.5, 1, 2], "qt": [1, 2, 4],
    "pt": [1, 2], "cup": [0.25, 0.5, 0.75, 1, 1.5, 2, 3], "fl oz": [8, 12, 16, 20, 32, 46, 52, 59, 64, 96, 128], "tbsp": [0.5, 1, 1.5, 2, 3, 4], "tsp": [0.25, 0.5, 1, 1.5, 2],
    "ct": [1, 2, 4, 6, 8, 10, 12, 18, 24, 30, 36, 48], "ea": [1, 2, 3, 4, 5, 6], "dozen": [0.5, 1, 1.5, 2, 2.5, 5]}
def qty(rng, u): return F(Decimal(str(rng.choice(REAL[u]))))
FOODS = {"mass": [("ground beef", "raw ground meat"), ("cheddar cheese", "hard cheese"), ("butter", "butter"), ("chicken thighs", "raw poultry"), ("rice", "dry goods/grains"),
                  ("bananas", "other fresh fruit"), ("potatoes", "root vegetables"), ("pretzels", "snacks"), ("spinach", "leafy greens"), ("salmon fillet", "raw fish"), ("firm tofu", "tofu")],
         "volume": [("whole milk", "milk"), ("orange juice", "beverages"), ("ketchup", "opened condiments"), ("heavy cream", "milk"), ("soy sauce", "opened condiments"), ("sparkling water", "beverages")],
         "count": [("eggs", "eggs"), ("bagels", "bread"), ("lemons", "other fresh fruit"), ("yogurt cups", "yogurt"), ("tortillas", "tortillas"), ("avocados", "other fresh fruit")]}
LIQUID_CATS = {"beverages", "milk", "opened condiments"}

def item(rng, dim):
    n, c = rng.choice(FOODS[dim])
    return n, c

def make_convert(rng, k):
    dim = rng.choice(["mass", "mass", "volume", "volume", "count"]); units = [u for u, (d, _) in UNITS.items() if d == dim]
    uf = rng.choice(units); ut = rng.choice([u for u in units if u != uf] + [BASE[dim]]); raw = rng.choice(ALIASES[uf])
    q = qty(rng, uf); name, cat = item(rng, dim); x = conv(q, uf, ut)
    st = F(Decimal(str(dec(x, 2))))                       # what numeric(10,2) keeps
    back = conv(st, ut, uf)
    return dict(id=f"U{k:05d}", kind="convert", name=name, category=cat if cat in CATS else None, input=dict(quantity=float(q), raw_unit=raw),
                unit=uf, dimension=dim, target_unit=ut, factor=exact(UNITS[uf][1] / UNITS[ut][1]), status="ok", result=val(x),
                round_trip=dict(stored=dec(x, 2), back_to_source=val(back), loss_exact=exact(abs(back - q))))

def make_receipt(rng, k, src):
    e = src["expected"]; q = F(Decimal(str(e["quantity"]))); out = dict(id=f"U{k:05d}", kind="receipt_to_pantry", source_case=src["id"], lines=src["lines"],
                                                                         name=src["normalized_name"], category=src["category"] if src["category"] in CATS else None)
    if e["unit"] in ("lb", "kg"):                                  # priced by weight
        x = conv(q, e["unit"], "g"); out.update(rule="weight", pantry=dict(count=None, content=val(x), content_unit="g"))
    elif e["pack"]:
        p = e["pack"]; n = q * p["count"]
        cu = p.get("size_unit")
        if cu and cu != "ct": per = F(Decimal(str(p["size"]))); c = conv(n * per, canon(cu.upper()) or cu, BASE[UNITS[cu][0]]); out.update(rule="pack_with_size", pantry=dict(count=val(n), content=val(c), content_unit=BASE[UNITS[cu][0]]))
        elif cu == "ct": n2 = n * F(Decimal(str(p["size"]))); out.update(rule="pack_of_counts", pantry=dict(count=val(n2), content=None, content_unit=None))
        else: out.update(rule="pack_count_only", pantry=dict(count=val(n), content=None, content_unit=None))
    elif e["size"]:
        s = e["size"]; su = s["unit"]; v = F(Decimal(str(s["value"])))
        if UNITS[su][0] == "count": out.update(rule="size_count", pantry=dict(count=val(q * v * UNITS[su][1]), content=None, content_unit=None))
        else:
            out.update(rule="size_in_name", pantry=dict(count=val(q), content=val(conv(q * v, su, BASE[UNITS[su][0]])), content_unit=BASE[UNITS[su][0]]))
            if su == "oz" and src["category"] in LIQUID_CATS: out["warnings"] = ["oz_on_liquid: 'OZ' treated as mass ounce per rule; the label likely means fl oz"]
    else: out.update(rule="count", pantry=dict(count=val(q), content=None, content_unit=None))
    out.update(app_quantity=e["app_quantity"], app_unit=e["app_unit"], status="ok")
    return out

def make_merge(rng, k):
    dim = rng.choice(["mass", "mass", "volume", "count"]); units = [u for u, (d, _) in UNITS.items() if d == dim and u not in ("tsp", "tbsp", "mg")]
    u1, u2 = rng.choice(units), rng.choice(units); q1, q2 = qty(rng, u1), qty(rng, u2)
    if rng.random() < 0.15: u2, q2 = u1, q2                           # same unit
    name, cat = item(rng, dim)
    incompatible = rng.random() < 0.12
    if incompatible:
        other = rng.choice([d for d in ("mass", "volume", "count") if d != dim]); u2 = rng.choice([u for u, (d, _) in UNITS.items() if d == other]); q2 = qty(rng, u2)
    tot = None if incompatible else q1 + conv(q2, u2, u1)
    return dict(id=f"U{k:05d}", kind="merge", name=name, category=cat if cat in CATS else None, existing=dict(quantity=float(q1), unit=u1),
                incoming=dict(quantity=float(q2), raw_unit=rng.choice(ALIASES[u2]), unit=u2),
                status="incompatible_dimension" if incompatible else "ok",
                result=None if incompatible else dict(unit=u1, **val(tot), base_unit=BASE[dim], base=val(q1 * UNITS[u1][1] + q2 * UNITS[u2][1])),
                rule="sum in base unit, express in the existing lot's unit; different dimensions stay separate lots")

def make_invalid(rng, k):
    t = rng.choice(["mass_to_volume", "volume_to_mass", "count_to_mass", "unknown_unit", "oz_on_liquid", "non_positive"])
    name, cat = item(rng, "volume" if t in ("oz_on_liquid", "volume_to_mass") else "mass")
    if t == "unknown_unit": return dict(id=f"U{k:05d}", kind="invalid", case=t, name=name, category=cat if cat in CATS else None, input=dict(quantity=1.0, raw_unit=rng.choice(UNKNOWN)), target_unit="g", status="unknown_unit", result=None)
    if t == "non_positive": return dict(id=f"U{k:05d}", kind="invalid", case=t, name=name, category=cat if cat in CATS else None, input=dict(quantity=rng.choice([0.0, -1.0, -0.5]), raw_unit="LB"), target_unit="g", status="invalid_quantity", result=None)
    a, b = {"mass_to_volume": ("mass", "volume"), "volume_to_mass": ("volume", "mass"), "count_to_mass": ("count", "mass"), "oz_on_liquid": ("mass", "volume")}[t]
    uf = "oz" if t == "oz_on_liquid" else rng.choice([u for u, (d, _) in UNITS.items() if d == a]); ut = rng.choice([u for u, (d, _) in UNITS.items() if d == b])
    return dict(id=f"U{k:05d}", kind="invalid", case=t, name=name, category=cat if cat in CATS else None, input=dict(quantity=float(qty(rng, uf)), raw_unit=rng.choice(ALIASES[uf])),
                unit=uf, target_unit=ut, status="incompatible_dimension", result=None,
                note="'OZ' without FL is a mass ounce; converting it to volume needs a density, which is never assumed" if t == "oz_on_liquid" else "needs a density / per-item weight; never assumed")

def main():
    rng = random.Random(SEED4 + 400_000); rows = []
    for _ in range(2000): rows.append(make_convert(rng, len(rows)))
    src = [json.loads(l) for l in open(os.path.join(FIXDIR, "large3", "quantity_parsing", "cases.jsonl"))]
    src = [r for r in src if r["category"] != "non_food"]
    pick = [r for r in src if r["expected"]["pack"] or (r["expected"]["size"] and r["expected"]["size"]["unit"] != "ea")]
    pick = sorted(rng.sample(pick, min(1000, len(pick))), key=lambda r: r["id"]) + sorted(rng.sample([r for r in src if r["expected"]["unit"] in ("lb", "kg")], 350), key=lambda r: r["id"]) \
        + sorted(rng.sample([r for r in src if r["expected"]["unit"] == "ea" and not r["expected"]["pack"] and not r["expected"]["size"]], 150), key=lambda r: r["id"])
    for r in pick: rows.append(make_receipt(rng, len(rows), r))
    for _ in range(1000): rows.append(make_merge(rng, len(rows)))
    for _ in range(500): rows.append(make_invalid(rng, len(rows)))
    jdump(os.path.join(OUT, "cases.jsonl"), rows)
    consts = {u: dict(dimension=d, base_unit=BASE[d], base_per_unit=exact(s), base_per_unit_decimal=dec(s, 12)) for u, (d, s) in UNITS.items()}
    json.dump(dict(constants=consts, aliases=ALIASES, unknown_units=UNKNOWN, sources={
        "lb": "international avoirdupois pound = 0.45359237 kg exactly (1959 agreement)", "oz": "1/16 lb", "gal": "US gallon = 231 cubic inches = 3.785411784 L exactly",
        "fl oz": "1/128 US gallon", "qt": "1/4 US gallon", "pt": "1/8 US gallon", "cup": "US customary cup = 1/16 US gallon (not the 240 mL nutrition-label cup)",
        "tbsp": "1/2 US fl oz", "tsp": "1/6 US fl oz", "dozen": "12"}, stored_rule="numeric(10,2) in supabase/migrations/0001_init.sql items.quantity; round half away from zero"),
        open(os.path.join(OUT, "constants.json"), "w"), indent=1)
    from collections import Counter
    print(len(rows), Counter(r["kind"] for r in rows), Counter(r.get("rule") for r in rows if r["kind"] == "receipt_to_pantry"), Counter(r["status"] for r in rows))

if __name__ == "__main__": main()
