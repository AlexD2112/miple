"""Item normalization pairs: raw abbreviated receipt text -> normalized_name + category, many variants per item/store,
with hard negatives. Every label points at its provenance (shelf_life.json example, receipt_lines.json line, the batch-1
non-food list, or a hard-negative analog that IS a shelf_life.json example). python3 gen_normalize.py [--n 30000]"""
import argparse
from rcore import *
from collections import Counter, defaultdict

EX = {e["item"]: e["category"] for e in SHELF["examples"]}
# (name, analog shelf_life example whose category it inherits, confusable category, note)
HARD = [
 ("chicken broth", "chicken broth carton", "raw poultry", "broth is shelf-stable carton, not raw chicken"),
 ("chicken noodle soup can", "chicken broth carton", "raw poultry", "canned soup"),
 ("chicken flavor ramen", "spaghetti", "raw poultry", "dry noodles"),
 ("frozen chicken nuggets", "frozen dumplings", "raw poultry", "frozen prepared"),
 ("chicken salad", "rotisserie chicken", "raw poultry", "prepared deli salad"),
 ("berry blast cereal", "cereal", "berries", "cereal (curated mapping puts cereal under snacks)"),
 ("strawberry yogurt", "vanilla yogurt cups", "berries", "yogurt"),
 ("strawberry jam", "ketchup", "berries", "jar condiment"),
 ("blueberry muffins", "bagels", "berries", "bakery"),
 ("frozen blueberries", "frozen mixed berries", "berries", "frozen"),
 ("raspberry sparkling water", "sparkling water", "berries", "beverage"),
 ("cherry cola", "cola 12pk", "berries", "beverage"),
 ("orange juice 52oz", "orange juice", "other fresh fruit", "juice vs fruit"),
 ("orange chicken frozen", "frozen dumplings", "other fresh fruit", "frozen entree"),
 ("mandarin orange cups", "diced tomatoes can", "other fresh fruit", "canned fruit cups"),
 ("apple juice", "orange juice", "other fresh fruit", "juice"),
 ("apple chips", "potato chips", "other fresh fruit", "snack"),
 ("applesauce cups", "diced tomatoes can", "other fresh fruit", "shelf-stable cups"),
 ("banana bread", "sourdough loaf", "other fresh fruit", "bakery"),
 ("banana chips", "potato chips", "other fresh fruit", "snack"),
 ("lemonade", "orange juice", "other fresh fruit", "beverage vs lemons"),
 ("lime sparkling water", "sparkling water", "other fresh fruit", "beverage vs limes"),
 ("pineapple chunks can", "diced tomatoes can", "other fresh fruit", "canned"),
 ("peanut butter", "peanut butter", "beverages", "PB = peanut butter"),
 ("pbr 12pk cans", "cola 12pk", "opened condiments", "PBR = Pabst Blue Ribbon beer, not PB"),
 ("peanut butter cups", "granola bars", "opened condiments", "candy/snack"),
 ("peanut butter crackers", "crackers", "opened condiments", "snack"),
 ("butter lettuce", "butter lettuce", "butter", "lettuce, not butter"),
 ("butternut squash", "zucchini", "butter", "squash, not butter"),
 ("ice cream", "ice cream", "soft cheese", "frozen, not cream cheese"),
 ("sour cream", "cream cheese", "frozen foods", "cultured dairy (editorial: soft cheese)"),
 ("coconut water", "orange juice", "canned goods", "beverage vs coconut milk can"),
 ("milk chocolate bar", "granola bars", "milk", "candy"),
 ("egg noodles", "spaghetti", "eggs", "dry pasta"),
 ("eggplant", "zucchini", "eggs", "vegetable"),
 ("frozen egg rolls", "frozen dumplings", "eggs", "frozen"),
 ("corn flakes", "cereal", "other fresh vegetables", "cereal"),
 ("frozen corn", "frozen peas", "other fresh vegetables", "frozen"),
 ("frozen hash browns", "frozen waffles", "root vegetables", "frozen potato"),
 ("potato salad", "prepared mac and cheese", "root vegetables", "prepared"),
 ("tomato soup can", "diced tomatoes can", "other fresh vegetables", "canned"),
 ("canned salmon", "tuna can", "raw fish", "canned fish"),
 ("fish sticks", "frozen dumplings", "raw fish", "frozen"),
 ("sliced turkey breast", "sliced turkey breast", "raw poultry", "deli vs raw turkey breast"),
 ("turkey breast", "turkey breast", "deli meat", "raw vs sliced deli"),
 ("ground coffee", "ground coffee", "raw ground meat", "GRND COFFEE vs GRND BF"),
 ("beef jerky", "potato chips", "raw whole cuts", "shelf-stable snack"),
 ("beef broth", "chicken broth carton", "raw ground meat", "carton broth"),
 ("bread crumbs", "all purpose flour", "bread", "dry goods"),
 ("frozen garlic bread", "frozen pizza", "bread", "frozen"),
 ("mint chip ice cream", "ice cream", "fresh herbs", "frozen vs fresh mint"),
 ("basil pesto", "salsa jar", "fresh herbs", "jar condiment"),
 ("dill pickles", "salsa jar", "fresh herbs", "jar condiment"),
 ("kale chips", "potato chips", "leafy greens", "snack"),
 ("rice milk", "oat milk", "dry goods/grains", "milk alternative"),
 ("rice cakes", "crackers", "dry goods/grains", "snack"),
 ("frozen cauliflower rice", "frozen broccoli", "other fresh vegetables", "frozen"),
 ("almond milk", "almond milk", "snacks", "milk alternative"),
 ("cream of mushroom soup", "diced tomatoes can", "other fresh vegetables", "canned soup"),
 ("tofu jerky", "potato chips", "tofu", "snack"),
]
ALT = {"CHICKEN": ["CHKN", "CHK", "CKN", "CHIC"], "BROTH": ["BRTH", "BRTH", "BROT"], "BERRY": ["BRY", "BERY"], "BLAST": ["BLST"],
       "CEREAL": ["CRL", "CER", "CERL"], "ORANGE": ["ORNG", "ORAN", "ORNGE"], "JUICE": ["JCE", "JC", "JUC"], "PEANUT": ["PNT", "PNUT", "PB"],
       "BUTTER": ["BTR", "BUTR", "BTTR"], "STRAWBERRY": ["STRWB", "STRBRY", "STRAW"], "BLUEBERRY": ["BLUBRY", "BLBRY"], "FROZEN": ["FRZN", "FZ", "FRZ"],
       "APPLE": ["APL", "APPL"], "BANANA": ["BAN", "BNNA"], "SPARKLING": ["SPRKLG", "SPKL", "SPK"], "WATER": ["WTR", "WAT"], "CAN": ["CN"],
       "CANS": ["CNS"], "SOUP": ["SP", "SOUP"], "TURKEY": ["TRKY", "TKY", "TURK"], "BREAST": ["BRST", "BRS"], "SLICED": ["SLCD", "SLC", "SL"],
       "GROUND": ["GRND", "GR", "GRD"], "COFFEE": ["COF", "CFE", "COFF"], "BEEF": ["BF", "BEF"], "CHEESE": ["CHS", "CHSE"], "CREAM": ["CRM", "CRM"],
       "YOGURT": ["YGRT", "YOG", "YGT"], "MILK": ["MLK", "MK"], "ORGANIC": ["ORG", "O"], "SALMON": ["SLMN", "SALM"], "POTATO": ["POT", "PTO"],
       "POTATOES": ["POTS", "POT"], "TOMATO": ["TOM", "TMTO"], "TOMATOES": ["TOM", "TOMS"], "CHIPS": ["CHP", "CHPS"], "CRACKERS": ["CRKRS", "CRKR"],
       "BREAD": ["BRD"], "MUFFINS": ["MUFF", "MFN"], "NOODLES": ["NDL", "NOOD"], "SALAD": ["SLD"], "LETTUCE": ["LTTC", "LET"], "SQUASH": ["SQ", "SQSH"],
       "CHOCOLATE": ["CHOC", "CHC"], "PICKLES": ["PKL", "PCKL"], "LEMONADE": ["LMNADE", "LMND"], "PINEAPPLE": ["PINE", "PNAPL"], "CHUNKS": ["CHNK"],
       "MANDARIN": ["MAND", "MNDRN"], "CUPS": ["CP", "CUP"], "FLAVOR": ["FLV", "FLVR"], "NUGGETS": ["NUGG", "NGT"], "VANILLA": ["VAN"],
       "LARGE": ["LG", "LRG"], "EGGS": ["EGG", "EGS"], "WHOLE": ["WHL", "WH"], "MIXED": ["MXD", "MIX"], "BERRIES": ["BRYS", "BERR"],
       "FRESH": ["FRSH", "FR"], "SWEET": ["SWT"], "GREEN": ["GRN"], "RED": ["RD"], "BABY": ["BBY", "BB"], "SPINACH": ["SPNCH", "SPIN"]}
SIZES = ["16OZ", "16 OZ", "1LB", "1 LB", "12CT", "12 CT", "32 FL OZ", "6PK", "2LB", "8OZ", "24OZ", "18CT", "64OZ", "5OZ", "10.5OZ", "3PK"]
SWAP = {"0": "O", "O": "0", "1": "I", "I": "1", "5": "S", "S": "5", "8": "B", "B": "8", "G": "6", "E": "F", "M": "N", "L": "I"}

def items():
    out, seen = [], set()
    for h in HARD:
        name, analog, conf, note = h
        assert analog in EX, analog
        out.append(dict(name=name, category=EX[analog], label_source=f"hard_negative:analog={analog}", hard_negative=True, confusable_with=conf, note=note))
        seen.add(name)
    for c in CATALOG:
        if c["name"] in seen: continue
        seen.add(c["name"])
        src = "shelf_life.examples" if c["name"] in EX else ("non_food_list" if c["category"] == "non_food" else
              "receipt_lines.json" if c.get("branded") else "batch1_catalog_beverages")
        if src == "shelf_life.examples": assert EX[c["name"]] == c["category"]
        out.append(dict(name=c["name"], category=c["category"], label_source=src, hard_negative=False, branded=c.get("branded", False)))
    return out

def variant(it, store, rng):
    ops = []
    toks = it["name"].upper().replace("'", "").replace("&", " & ").split()
    out = []
    for t in toks:
        r = rng.random()
        if t in ALT and r < 0.65: out.append(rng.choice(ALT[t])); ops.append("alt_abbrev")
        elif t in WORDS and r < 0.75: out.append(WORDS[t])
        elif len(t) > 5 and r < 0.85: out.append(t[0] + re.sub(r"[AEIOU]", "", t[1:])); ops.append("vowel_drop")
        elif len(t) > 6 and r < 0.92: out.append(t[:4]); ops.append("clip4")
        else: out.append(t)
    raw = " ".join(out)
    if rng.random() < 0.15 and not re.search(r"\d", raw): raw += " " + rng.choice(SIZES); ops.append("size_suffix")
    pref = "" if it.get("branded") else brand_for(it, store, rng) if it["category"] in CATS or it["category"] == "non_food" else ""
    if pref: ops.append("store_brand")
    raw = pref + raw
    if store == "Trader Joe's" and rng.random() < 0.3: raw = raw.title(); ops.append("mixed_case")
    # truncation (printer width) only clips inside the LAST token, keeping >=3 of its chars, so the item stays identifiable
    if rng.random() < 0.2:
        head, _, last = raw.rpartition(" ")
        if head and len(last) > 4:
            raw = head + " " + last[:rng.randint(3, len(last) - 1)]; ops.append("truncated")
    if store == "Costco": raw = f"{rng.randint(1000, 1999999)} " + raw; ops.append("costco_item_number")
    if rng.random() < 0.06:
        ch = list(raw); idx = [i for i, c in enumerate(ch) if c in SWAP]
        if idx:
            for i in rng.sample(idx, min(2, len(idx))): ch[i] = SWAP[ch[i]]
            raw = "".join(ch); ops.append("ocr_noise")
    return raw, sorted(set(ops))

def key(raw):  # store-independent comparable form
    return re.sub(r"^\d{4,7} ", "", raw).upper().strip()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--n", type=int, default=30000); a = ap.parse_args()
    rng = random.Random(SEED2 + 200_000); its = items()
    weights = [2 if i["hard_negative"] else 1 for i in its]; cap = Counter(); per_store = a.n * 1.08 / 7 * 1.1
    rows, seen = [], set(); by_key = defaultdict(set); tries = 0
    while len(rows) < a.n * 1.08 and tries < a.n * 40:
        tries += 1
        it = rng.choices(its, weights)[0]; store = STORES[tries % 7]
        raw, ops = variant(it, store, rng)
        if len(key(raw)) < 3 or (store, raw) in seen or cap[store] >= per_store: continue
        cap[store] += 1
        seen.add((store, raw)); by_key[key(raw)].add((it["name"], it["category"]))
        rows.append(dict(store=store, raw_text=raw, normalized_name=it["name"], category=it["category"],
                         app_category_key=CATS[it["category"]].get("app_category_key") if it["category"] in CATS else None,
                         label_source=it["label_source"], hard_negative=it["hard_negative"], confusable_with=it.get("confusable_with"),
                         variant_ops=ops, ocr_noise="ocr_noise" in ops, observed=False, synthetic=True))
    amb = {k for k, v in by_key.items() if len(v) > 1}  # >1 distinct (name, category) for the same raw text
    clean = [r for r in rows if key(r["raw_text"]) not in amb][:a.n]
    ambiguous = []
    for k in sorted(amb):
        cands = sorted(by_key[k])
        ambiguous.append(dict(raw_text=k, candidates=[dict(normalized_name=n, category=c) for n, c in cands], category=None,
                              note="same raw text produced from items in different categories; correct label is ambiguous without context",
                              synthetic=True))
    for i, r in enumerate(clean): r["id"] = f"NP{i:06d}"
    for i, r in enumerate(ambiguous): r["id"] = f"NA{i:05d}"
    out = os.path.join(LARGE2, "normalization")
    for s in range(0, len(clean), 10000): jdump(os.path.join(out, f"pairs_{s // 10000:03d}.jsonl"), clean[s:s + 10000])
    if ambiguous: jdump(os.path.join(out, "ambiguous.jsonl"), ambiguous)
    jdump(os.path.join(out, "items.jsonl"), [dict(it, id=f"NI{i:04d}") for i, it in enumerate(its)])
    print(len(clean), "ambiguous", len(ambiguous), "items", len(its), "hard_neg rows", sum(r["hard_negative"] for r in clean),
          Counter(r["store"] for r in clean), Counter(o for r in clean for o in r["variant_ops"]),
          "per-item min/max", min(Counter(r["normalized_name"] for r in clean).values()), max(Counter(r["normalized_name"] for r in clean).values()))

if __name__ == "__main__": main()
