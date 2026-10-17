"""Shared, deterministic building blocks for the fixtures/large generators.
Everything here is synthetic. Shelf-life numbers are only ever READ from ../../shelf_life.json."""
import json, os, re, random, datetime as dt
from decimal import Decimal as D, ROUND_HALF_UP

GEN = os.path.dirname(os.path.abspath(__file__))
LARGE = os.path.dirname(GEN)
FIX = os.path.dirname(LARGE)
SEED = 20261017

def load(name): return json.load(open(os.path.join(FIX, name)))
SHELF = load("shelf_life.json")
ALLERGENS = load("allergens.json")
CURATED_LINES = load("receipt_lines.json")["lines"]
CATS = {c["category"]: c for c in SHELF["categories"]}
EXTRA_CATS = {"non_food", "discount", "deposit", "fee"}
STORES = ["Safeway", "QFC", "Fred Meyer", "Trader Joe's", "Costco", "Whole Foods", "Target"]

def money(x): return D(str(x)).quantize(D("0.01"), rounding=ROUND_HALF_UP)

# ---------------------------------------------------------------- locations & tax
# Rates/rules are documented in ../README.md (sources: WA DOR, CDTFA, Oregon has no sales tax).
LOCATIONS = {
    "WA": dict(city="Seattle WA", rate=D("0.1055"), bag=D("0.08"), bag_taxable=True, deposit=None),
    "OR": dict(city="Portland OR", rate=D("0"), bag=D("0.05"), bag_taxable=False, deposit="OR"),
    "CA": dict(city="San Francisco CA", rate=D("0.08625"), bag=D("0.25"), bag_taxable=False, deposit="CA"),
}
STORE_LOCATIONS = {  # weights: mostly Seattle
    "Safeway": [("WA", 8), ("CA", 2)], "QFC": [("WA", 1)], "Fred Meyer": [("WA", 7), ("OR", 3)],
    "Trader Joe's": [("WA", 6), ("OR", 2), ("CA", 2)], "Costco": [("WA", 8), ("OR", 1), ("CA", 1)],
    "Whole Foods": [("WA", 7), ("OR", 1), ("CA", 2)], "Target": [("WA", 7), ("OR", 1), ("CA", 2)],
}
def pick_weighted(rng, pairs):
    tot = sum(w for _, w in pairs); r = rng.uniform(0, tot)
    for v, w in pairs:
        r -= w
        if r <= 0: return v
    return pairs[-1][0]

SOFT_DRINK = re.compile(r"\b(cola|coke|pepsi|sprite|soda|root beer|ginger ale|dr pepper|mountain dew|energy drink|kombucha soda|lemonade)\b", re.I)
CARBONATED = re.compile(r"\b(cola|coke|pepsi|sprite|soda|root beer|ginger ale|dr pepper|mountain dew|sparkling|seltzer|lacroix)\b", re.I)
PREPARED = re.compile(r"\b(rotisserie|hot bar|fried chicken|hot soup)\b", re.I)

def taxable(item, loc):
    """WA: non-food, soft drinks, hot prepared food taxable; food exempt.
    CA: non-food, carbonated beverages, hot prepared food taxable. OR: no sales tax."""
    if LOCATIONS[loc]["rate"] == 0: return False
    c, n = item["category"], item["name"]
    if c == "non_food": return True
    if c == "beverages": return bool(SOFT_DRINK.search(n)) if loc == "WA" else bool(CARBONATED.search(n))
    if PREPARED.search(n): return True
    return False

# ---------------------------------------------------------------- catalog
BRAND = {
    "Safeway": ["SIG SLCT ", "SIG KTCHNS ", "O ORGANICS ", "LUCERNE ", "SW ", ""],
    "QFC": ["KRO ", "SMPL TRTH ", "PRIV SEL ", ""], "Fred Meyer": ["KRO ", "SMPL TRTH ", "FM ", ""],
    "Trader Joe's": ["TJ'S ", "", ""], "Costco": ["KS ", "KS ", ""], "Whole Foods": ["365 ", "365 ORG ", "WF ", ""],
    "Target": ["GG ", "GG ", "MKT PANTRY ", ""],
}
NONFOOD_BRAND = {"Target": ["UP&UP "], "Costco": ["KS "], "Whole Foods": ["365 "], "Safeway": ["SIG "], "QFC": ["KRO "], "Fred Meyer": ["KRO "], "Trader Joe's": [""]}
WORDS = {"ORGANIC": "ORG", "CHICKEN": "CHKN", "BREAST": "BRST", "BONELESS": "BNLS", "SKINLESS": "SKNLS", "GROUND": "GRND",
    "BEEF": "BF", "TURKEY": "TRKY", "CHEESE": "CHS", "CHEDDAR": "CHDR", "SHARP": "SHRP", "YOGURT": "YGRT", "GREEK": "GRK",
    "MILK": "MLK", "BREAD": "BRD", "WHOLE": "WHL", "WHEAT": "WHT", "TORTILLAS": "TORT", "FROZEN": "FRZN", "BROCCOLI": "BROC",
    "POTATOES": "POTS", "STRAWBERRIES": "STRWB", "BLUEBERRIES": "BLUBRY", "RASPBERRIES": "RASPB", "SPINACH": "SPNCH",
    "LETTUCE": "LTTC", "VANILLA": "VAN", "CHOCOLATE": "CHOC", "PEANUT": "PNT", "BUTTER": "BTR", "TOMATOES": "TOM",
    "MUSHROOMS": "MSHRM", "CRACKERS": "CRKRS", "SPARKLING": "SPRKLG", "WATER": "WTR", "ROTISSERIE": "ROTIS", "SLICED": "SLCD",
    "PEPPER": "PEPR", "ONIONS": "ONIN", "LARGE": "LG", "SMALL": "SM", "PACK": "PK", "COUNT": "CT", "OUNCE": "OZ", "POUND": "LB",
    "WITH": "W/", "AND": "&", "UNSALTED": "UNSLTD", "SALTED": "SLTD", "FILLET": "FLLT", "SALMON": "SLMN", "PARMESAN": "PARM",
    "MOZZARELLA": "MOZZ", "CREAM": "CRM", "SAUCE": "SCE", "PASTA": "PSTA", "CEREAL": "CRL", "GRANOLA": "GRNLA", "BARS": "BRS"}

def abbreviate(name, rng, level):
    """level 0: plain upper; 1: word map; 2: word map + vowel drop on long words."""
    toks = name.upper().replace("'", "").split()
    out = []
    for t in toks:
        if level >= 1 and t in WORDS: t = WORDS[t]
        elif level >= 2 and len(t) > 6 and rng.random() < 0.6:
            t = t[0] + re.sub(r"[AEIOU]", "", t[1:])
        out.append(t)
    return " ".join(out)

# synthetic price bands per category (USD per 'ea' or per lb) - NOT from any source; documented as synthetic
PRICE_BAND = {"leafy greens": (1.99, 5.99), "berries": (2.99, 7.99), "other fresh fruit": (0.59, 4.99),
    "root vegetables": (0.99, 4.99), "other fresh vegetables": (0.99, 4.49), "fresh herbs": (0.79, 2.99),
    "raw poultry": (3.49, 12.99), "raw ground meat": (4.99, 9.99), "raw whole cuts": (6.99, 24.99), "raw fish": (8.99, 29.99),
    "deli meat": (3.99, 8.99), "eggs": (2.99, 9.99), "milk": (2.49, 6.99), "yogurt": (0.99, 7.99), "soft cheese": (2.49, 8.99),
    "hard cheese": (2.49, 12.99), "butter": (3.99, 12.99), "bread": (1.99, 7.49), "tortillas": (1.99, 6.99),
    "cooked leftovers": (4.99, 12.99), "tofu": (1.99, 3.99), "opened condiments": (1.99, 6.99), "canned goods": (0.79, 10.99),
    "dry goods/grains": (1.29, 19.99), "frozen foods": (1.49, 15.99), "beverages": (0.99, 9.99), "snacks": (1.99, 6.99),
    "non_food": (1.99, 24.99)}
WEIGHT_CATS = {"other fresh fruit", "root vegetables", "other fresh vegetables", "raw poultry", "raw whole cuts", "raw fish",
               "deli meat", "hard cheese", "raw ground meat", "cooked leftovers"}
PER_LB_BAND = {"other fresh fruit": (0.59, 3.49), "root vegetables": (0.79, 2.49), "other fresh vegetables": (0.99, 3.99),
    "raw poultry": (2.99, 8.99), "raw whole cuts": (3.99, 21.99), "raw fish": (8.99, 24.99), "deli meat": (8.99, 15.99),
    "hard cheese": (8.99, 24.99), "raw ground meat": (4.49, 8.99), "cooked leftovers": (9.99, 12.99)}
NON_FOOD = ["paper towels 6 roll", "bath tissue 12 roll", "dish soap", "laundry detergent pods", "trash bags 40ct",
    "aluminum foil", "plastic wrap", "sponges 3pk", "toothpaste", "shampoo", "aa batteries 8pk", "light bulbs 4pk",
    "zip top bags", "paper plates", "napkins", "hand soap", "flowers bouquet", "greeting card", "cat litter", "dog treats"]
BEV_EXTRA = ["cola 12pk cans", "diet cola 12pk cans", "root beer 2l", "ginger ale 12pk", "sparkling water 8pk", "lemonade 52oz",
             "orange juice 52oz", "apple juice 64oz", "bottled water 24pk", "cold brew coffee 32oz", "kombucha 16oz"]
CONTAINERS = re.compile(r"(\d+)\s*pk", re.I)

STORE_BRANDS = re.compile(r"^(365 by whole foods( organic)?|365 organic|365|kirkland signature|kirkland|good & gather( organic)?|kroger( organic)?|simple truth( organic)?|private selection|signature select|signature kitchens|lucerne|o organics|tj's|trader joe's|up & up|seventh generation|wf|sw|kro)\s+", re.I)
def _detail_free(r): return "detail line" not in r["normalized_name"]

def build_catalog():
    rng = random.Random(SEED + 1)
    items = []
    for ex in SHELF["examples"]:
        items.append(dict(name=ex["item"], category=ex["category"], branded=False))
    for r in CURATED_LINES:
        if _detail_free(r) and r["category"] in CATS and r["price"]:
            items.append(dict(name=STORE_BRANDS.sub("", re.sub(r"\s*\(.*?\)", "", r["normalized_name"])).strip(), category=r["category"], branded=True))
    for n in NON_FOOD: items.append(dict(name=n, category="non_food", branded=False))
    for n in BEV_EXTRA: items.append(dict(name=n, category="beverages", branded=False))
    seen, cat = set(), []
    for it in items:
        k = it["name"].lower()
        if k in seen: continue
        seen.add(k)
        lo, hi = PRICE_BAND[it["category"]]
        it["price"] = money(rng.uniform(lo, hi))
        it["by_weight"] = it["category"] in WEIGHT_CATS and rng.random() < 0.6 and not re.search(r"\d\s*(oz|lb|ct|pk|gal)\b|\bcan\b", it["name"], re.I)
        if it["by_weight"]:
            lo, hi = PER_LB_BAND[it["category"]]; it["price"] = money(rng.uniform(lo, hi))
        m = CONTAINERS.search(it["name"])
        it["containers"] = int(m.group(1)) if (it["category"] == "beverages" and m) else (1 if it["category"] == "beverages" else 0)
        it["big_container"] = bool(re.search(r"\b(2l|52oz|64oz|32oz)\b", it["name"]))
        cat.append(it)
    return cat
CATALOG = build_catalog()

DAIRY = {"milk", "yogurt", "soft cheese", "hard cheese", "butter", "eggs"}
PRODUCE = {"leafy greens", "berries", "other fresh fruit", "root vegetables", "other fresh vegetables", "fresh herbs"}
def brand_for(item, store, rng):
    c = item["category"]
    if c == "non_food": return rng.choice(NONFOOD_BRAND.get(store, [""]) + [""])
    opts = list(BRAND[store])
    if store == "Safeway":
        opts = ["LUCERNE ", ""] if c in DAIRY else ["O ORGANICS ", ""] if c in PRODUCE else ["SIG SLCT ", "SIG KTCHNS ", "SW ", ""]
    if store in ("QFC", "Fred Meyer") and c in PRODUCE: opts = ["SMPL TRTH ", ""]
    return rng.choice(opts)

def store_raw(item, store, rng, width=40):
    lvl = rng.choice([0, 1, 1, 2, 2]) if store != "Trader Joe's" else rng.choice([0, 0, 1])
    pref = "" if item.get("branded") else brand_for(item, store, rng)
    short = abbreviate(item["name"], rng, lvl)
    raw = pref + short
    if store == "Costco": raw = f"{rng.randint(1000, 1999999):d} " + raw
    return raw, short

# ---------------------------------------------------------------- dates
def rand_date(rng, start=dt.date(2026, 1, 1), end=dt.date(2026, 10, 17)):
    return start + dt.timedelta(days=rng.randint(0, (end - start).days))

WEIGHT_RANGE = {"deli meat": (0.25, 1.5), "hard cheese": (0.25, 1.5), "cooked leftovers": (0.5, 2.2), "raw fish": (0.4, 3.0),
                "raw whole cuts": (0.6, 4.0), "raw poultry": (0.8, 6.5), "raw ground meat": (0.8, 5.0)}
MULTI_OK = {"other fresh fruit", "berries", "fresh herbs", "yogurt", "canned goods", "dry goods/grains", "beverages", "snacks",
            "frozen foods", "tofu", "bread", "tortillas", "opened condiments", "other fresh vegetables", "leafy greens"}
COUPON_LABELS = {"Safeway": ["CLUB CARD ", "J4U CPN ", "MFR CPN ", "SC "], "QFC": ["SC ", "DIGITAL CPN ", "MFR CPN ", "KRO SAVINGS "],
                 "Fred Meyer": ["SC ", "DIGITAL CPN ", "MFR CPN ", "KRO SAVINGS "]}
