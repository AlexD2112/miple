"""LLM-output safety cases: simulated RecipeDraft (server/src/domain/schemas.ts) vs allergy profiles.
expected_verdict  = reference: batch-1 matcher over allergens.json applied to CANONICAL ingredients, with the documented
                    EXPANSIONS (compound dishes/sauces), FOREIGN and MISSPELL lookup tables (assumptions, see README).
app_verdict       = exact port of server/src/domain/allergens.ts violatesAllergies/findAllergens (cross-checked with node).
python3 gen_llm_safety.py"""
import os, json, random, subprocess, unicodedata
from core3 import *
from allergen_matcher import analyze
from app_allergens import KEYWORDS, find_allergens, violates

APP_KEYS = list(KEYWORDS)
GLUTEN_ONLY = [w for w in KEYWORDS["gluten"] if w not in KEYWORDS["wheat"]]  # barley, rye, malt, farro, spelt (app code)
# Documented assumption: typical components of compound foods (real recipes vary). Component labels then come from allergens.json.
EXPANSIONS = {
 "basil pesto": ["basil", "pine nuts", "parmesan", "olive oil", "garlic"], "pesto": ["basil", "pine nuts", "parmesan", "olive oil", "garlic"],
 "teriyaki sauce": ["soy sauce", "mirin", "sugar", "ginger"], "worcestershire sauce": ["vinegar", "molasses", "anchovies", "tamarind", "onion"],
 "caesar dressing": ["olive oil", "anchovies", "egg yolk", "parmesan", "lemon juice", "garlic"],
 "pad thai sauce": ["tamarind paste", "fish sauce", "palm sugar"], "pad thai": ["rice noodles", "peanuts", "fish sauce", "eggs", "tamarind paste", "bean sprouts"],
 "naan": ["wheat flour", "yogurt", "ghee", "yeast"], "garlic naan": ["wheat flour", "yogurt", "ghee", "garlic"],
 "parmesan": ["cheese"], "feta": ["cheese"], "mozzarella": ["cheese"], "paneer": ["cheese"],
 "soy sauce": ["soybeans", "wheat", "salt"], "shoyu": ["soybeans", "wheat", "salt"], "hoisin sauce": ["soybeans", "sugar", "wheat flour", "garlic", "sesame oil"],
 "oyster sauce": ["oysters", "sugar", "salt", "corn starch"], "fish sauce": ["anchovies", "salt"],
 "aioli": ["egg yolk", "garlic", "olive oil"], "alfredo sauce": ["butter", "heavy cream", "parmesan"], "bechamel": ["butter", "wheat flour", "milk"],
 "ranch dressing": ["buttermilk", "mayonnaise", "herbs"], "tzatziki": ["greek yogurt", "cucumber", "garlic"], "hummus": ["chickpeas", "tahini", "lemon juice"],
 "baba ganoush": ["eggplant", "tahini", "lemon juice"], "dukkah": ["hazelnuts", "sesame seeds", "coriander", "cumin"],
 "romesco": ["roasted red peppers", "almonds", "bread", "olive oil"], "muhammara": ["roasted red peppers", "walnuts", "bread crumbs", "pomegranate molasses"],
 "korma sauce": ["cashews", "heavy cream", "onion", "spices"], "satay sauce": ["peanut butter", "coconut milk", "soy sauce", "lime juice"],
 "katsu": ["panko", "eggs", "wheat flour", "pork cutlet"], "tempura batter": ["wheat flour", "eggs", "ice water"],
 "red curry paste": ["chilies", "lemongrass", "shrimp paste", "garlic"], "kimchi": ["napa cabbage", "chili flakes", "fish sauce", "garlic"],
 "xo sauce": ["dried shrimp", "dried scallops", "chilies", "oil"], "baklava": ["phyllo dough", "walnuts", "pistachios", "butter", "honey"],
 "phyllo dough": ["wheat flour", "water", "oil"], "spaghetti": ["durum wheat semolina"], "pasta": ["durum wheat semolina"], "gnocchi": ["potatoes", "wheat flour", "eggs"], "miso soup": ["miso paste", "tofu", "seaweed"],
 "tamari": ["soybeans", "salt"], "mole sauce": ["chilies", "peanuts", "sesame seeds", "chocolate", "bread"], "gado gado dressing": ["peanuts", "soy sauce", "lime juice"],
 "ponzu": ["soy sauce", "citrus juice", "mirin"], "furikake": ["sesame seeds", "seaweed", "bonito flakes"], "bonito flakes": ["fish"],
 "pho broth": ["beef bones", "fish sauce", "spices"], "crab rangoon": ["crab meat", "cream cheese", "wonton wrappers"], "wonton wrappers": ["wheat flour", "eggs"],
}
# Documented assumption: common non-English ingredient words -> canonical English
FOREIGN = {"cacahuetes": "peanuts", "cacahuate": "peanuts", "maní": "peanuts", "arachides": "peanuts", "erdnüsse": "peanuts",
           "nueces": "walnuts", "noix": "walnuts", "almendras": "almonds", "amandes": "almonds", "mandeln": "almonds", "piñones": "pine nuts",
           "leche": "milk", "lait": "milk", "milch": "milk", "queso": "cheese", "fromage": "cheese", "käse": "cheese", "mantequilla": "butter",
           "beurre": "butter", "crema": "cream", "nata": "cream", "huevos": "eggs", "œufs": "eggs", "oeufs": "eggs", "eier": "eggs", "tamago": "eggs",
           "harina de trigo": "wheat flour", "farine de blé": "wheat flour", "weizenmehl": "wheat flour", "camarones": "shrimp", "gambas": "shrimp",
           "crevettes": "shrimp", "garnelen": "shrimp", "ebi": "shrimp", "cangrejo": "crab meat", "kani": "crab meat", "pescado": "fish", "poisson": "fish",
           "salmón": "salmon", "atún": "tuna", "anchoas": "anchovies", "sésamo": "sesame seeds", "ajonjolí": "sesame seeds", "goma": "sesame seeds",
           "sésame": "sesame seeds", "soja": "soybeans", "shoyu": "soy sauce", "salsa de soja": "soy sauce", "tofu frito": "tofu"}
MISSPELL = {"peanuts": ["penuts", "peanutts", "peanus", "pea nuts"], "peanut butter": ["penut butter", "peanutbutter"], "almonds": ["almods", "almnds", "allmonds"],
            "cashews": ["cashwes", "cashues", "cashew's"], "walnuts": ["walnts", "wallnuts"], "pine nuts": ["pinenuts", "pine-nuts", "pinnuts"],
            "pistachios": ["pistachoes", "pistacios"], "parmesan": ["parmasan", "parmesean", "parmigian"], "mayonnaise": ["mayonaise", "mayonase", "mayo-naise"],
            "eggs": ["egs", "eggz"], "sesame seeds": ["sesmae seeds", "seseme seeds", "sesame-seeds"], "tahini": ["tahina", "tahinni"],
            "soy sauce": ["soysauce", "soy-sauce", "soya sauce"], "worcestershire sauce": ["worchestershire sauce", "worcester sauce", "woostershire sauce"],
            "shrimp": ["shrimps", "srimp", "shirmp"], "anchovies": ["anchovys", "anchovie"], "yogurt": ["yougurt", "yoghurt"], "butter": ["buttter", "buter"],
            "cheese": ["cheeze", "chese"], "wheat flour": ["weat flour", "wheatflour"], "tofu": ["tofoo"], "crab meat": ["crabmeat", "krab meat"],
            "salmon": ["samon", "salmón"], "heavy cream": ["heavy creme", "heavycream"], "hazelnuts": ["hazlenuts", "hazel nuts"]}
DIRECT = {"peanut": ["peanuts", "peanut butter", "crushed peanuts"], "tree_nut": ["almonds", "cashews", "walnuts", "pine nuts", "pecans", "pistachios", "hazelnuts"],
          "milk": ["whole milk", "butter", "heavy cream", "greek yogurt", "cheddar cheese", "cheese", "ghee"], "egg": ["eggs", "egg yolk", "mayonnaise"],
          "wheat": ["wheat flour", "spaghetti", "bread crumbs", "flour tortillas", "panko"], "gluten": ["barley", "rye bread", "malt vinegar", "farro", "spelt flour"],
          "soy": ["tofu", "edamame", "miso paste", "soybeans"], "fish": ["salmon", "anchovies", "fish sauce", "cod", "tuna"],
          "shellfish": ["shrimp", "crab meat", "lobster", "scallops", "clams", "squid"], "sesame": ["sesame seeds", "tahini", "sesame oil"]}
NEUTRAL = ["chicken breast", "brown rice", "broccoli", "olive oil", "garlic", "onion", "black beans", "quinoa", "spinach", "bell pepper", "salt",
           "black pepper", "lime juice", "cilantro", "potatoes", "carrots", "ground turkey", "zucchini", "tomatoes", "lentils", "avocado",
           "sweet potato", "chickpeas", "ginger", "green onions", "cucumber", "lemon juice", "honey", "cumin", "paprika", "kale", "mushrooms",
           "pork tenderloin", "beef sirloin", "jasmine rice", "corn", "cabbage", "cauliflower", "canola oil", "vegetable broth", "apple"]
TRAPS = ["coconut milk", "cream of tartar", "cocoa butter", "buckwheat noodles", "rice noodles", "corn tortillas", "gluten-free pasta",
         "sunflower seed butter", "eggplant", "butternut squash", "nutmeg", "water chestnuts", "peanut-free granola", "coconut yogurt",
         "rice flour", "oat milk", "almond-free pesto (basil, sunflower seeds, olive oil)", "nutritional yeast", "dairy-free butter (coconut oil)"]
TITLES = ["{a} bowl", "{a} stir-fry", "Sheet-pan {a}", "{a} salad", "Quick {a} skillet", "One-pot {a}", "{a} curry", "{a} plate"]  # no allergen-implying words
UNKNOWN = ["mango", "kiwi", "strawberry", "garlic", "celery", "mustard", "lupin", "corn"]

def ref_keys(canon):
    """Reference allergens for a canonical ingredient: (contains app keys, may_contain app keys, path list)."""
    comps = EXPANSIONS.get(canon.lower())
    parts = [(c, f"expansion:{canon.lower()}") for c in comps] if comps else [(canon, "direct")]
    cont, may, via = set(), set(), {}
    for c, how in parts:
        if c.lower() in EXPANSIONS and c.lower() != canon.lower():
            c2, m2, v2 = ref_keys(c)
            for k in c2: via.setdefault(k, []).extend(f"{how}>{x}" for x in v2.get(k, [c]))
            cont |= c2; may |= m2; continue
        a = analyze(c); ks = set(a["app_keys"])
        if a["mollusks"]: ks.add("shellfish")     # app 'shellfish' keyword list includes mollusks
        if "wheat" in ks or any(re.search(r"\b" + w + r"\b", c.lower()) for w in GLUTEN_ONLY): ks.add("gluten")
        mk = {{"tree nuts": "tree_nut", "peanuts": "peanut", "eggs": "egg", "crustacean shellfish": "shellfish"}.get(x, x) for x in a["may_contain"]}
        if "wheat" in mk: mk.add("gluten")
        for k in ks: via.setdefault(k, []).append(f"{how}:{c}")
        cont |= ks; may |= mk
    return cont, may - cont, via

# ------------------------------------------------ surface tricks
HOMO = {"a": "а", "e": "е", "o": "о", "p": "р", "c": "с", "x": "х", "y": "у"}  # Cyrillic look-alikes
def trick_unicode(s, rng):
    op = rng.choice(["fullwidth", "zero_width", "homoglyph", "accent", "soft_hyphen", "nbsp", "combining"])
    if op == "fullwidth": return "".join(chr(ord(c) + 0xFEE0) if "!" <= c <= "~" else c for c in s), op
    if op == "zero_width" and len(s) > 3: i = rng.randint(1, len(s) - 2); return s[:i] + "\u200b" + s[i:], op
    if op == "homoglyph":
        idx = [i for i, c in enumerate(s) if c in HOMO]
        if idx: i = rng.choice(idx); return s[:i] + HOMO[s[i]] + s[i + 1:], op
    if op == "accent":
        idx = [i for i, c in enumerate(s) if c in "aeiou"]
        if idx: i = rng.choice(idx); return s[:i] + {"a": "á", "e": "é", "i": "í", "o": "ó", "u": "ú"}[s[i]] + s[i + 1:], op
    if op == "soft_hyphen" and len(s) > 3: i = rng.randint(1, len(s) - 2); return s[:i] + "\u00ad" + s[i:], op
    if op == "nbsp" and " " in s: return s.replace(" ", "\u00a0", 1), op
    if op == "combining" and len(s) > 2: i = rng.randint(0, len(s) - 1); return s[:i + 1] + "\u0301" + s[i + 1:], op
    return s.upper(), "upper_fallback"
def trick_case(s, rng):
    op = rng.choice(["upper", "title", "alternating"])
    if op == "upper": return s.upper(), op
    if op == "title": return s.title(), op
    return "".join(c.upper() if i % 2 else c for i, c in enumerate(s)), op
PLURALS = {"anchovy": "anchovies", "peanut": "peanuts", "cashew": "cashews", "egg": "eggs", "shrimp": "shrimp", "walnut": "walnuts", "almond": "almonds",
           "oyster": "oysters", "loaf of bread": "loaves of bread", "tortilla": "tortillas", "noodle": "noodles", "prawn": "prawns", "clam": "clams",
           "sardine": "sardines", "scallop": "scallops", "mussel": "mussels", "anchovy fillet": "anchovy fillets", "hazelnut": "hazelnuts",
           "brazil nut": "brazil nuts", "pine nut": "pine nuts", "crab": "crabs", "lobster tail": "lobster tails", "sesame seed": "sesame seeds",
           "mozzarella ball": "mozzarella balls", "berry": "berries", "pastry": "pastries", "cheese": "cheeses", "tomato": "tomatoes", "potato": "potatoes"}

def recipe(rng, ings, title=None, steps_extra=None, declared=None):
    t = title or rng.choice(TITLES).format(a=rng.choice([n for n, _ in ings if not any(ord(ch) > 127 for ch in n)] or ["veggie"]).split(" (")[0].title())
    lst = [dict(pantry_item_id=None, name=n, quantity=rng.choice(["1 cup", "2 tbsp", "200 g", "1", "1/2 cup", "3 oz", "to taste", "2"])) for n, _ in ings]
    steps = [f"Prep the {lst[0]['name']}.", "Cook everything over medium heat until done.", "Season and serve."]
    if steps_extra: steps.insert(2, steps_extra)
    return dict(title=t, minutes=rng.choice([10, 15, 20, 25, 30, 40, 45]), servings=rng.choice([1, 2, 2, 4]), ingredients=lst, steps=steps,
                calories=rng.randint(250, 900), protein_g=rng.randint(5, 60), carbs_g=rng.randint(5, 110), fat_g=rng.randint(3, 50),
                declared_allergens=declared or [])

def label(rec, canon_list, profile, steps_canon=None, declared=None):
    """canon_list: canonical ingredient strings (title dish included if any)."""
    cont, may, via = set(), set(), {}
    for c in canon_list + (steps_canon or []):
        c2, m2, v2 = ref_keys(c); cont |= c2; may |= m2
        for k, v in v2.items(): via.setdefault(k, []).extend(v)
    known = [a for a in profile if a in KEYWORDS]; unknown = [a for a in profile if a not in KEYWORDS]
    canon_text = " \n ".join(canon_list + (steps_canon or [])).lower()
    unk_hits = [u for u in unknown if re.search(r"\b" + re.escape(u) + r"(e?s)?\b", canon_text)]
    offending = {k: sorted(set(via[k])) for k in known if k in cont}
    for u in unk_hits: offending[u] = ["literal"]
    decl_hit = [a for a in profile if a in [d.lower() for d in (declared or [])]]
    if offending or decl_hit: verdict = "reject"
    elif set(known) & may: verdict = "caution"
    else: verdict = "allow"
    app_v, reason = violates(rec, profile)
    hits, terms = find_allergens([rec["title"]] + [i["name"] for i in rec["ingredients"]] + rec["steps"], profile, with_terms=True)
    app = dict(violates=app_v, reason=reason, hits=hits, matched_terms=terms)
    gap = None
    if verdict == "reject" and not app_v: gap = "app_false_negative"
    elif verdict == "allow" and app_v: gap = "app_false_positive"
    return dict(expected_verdict=verdict, offending=offending, declared_hits=decl_hit, caution_allergens=sorted(set(known) & may),
                present_allergens=sorted(cont), app_verdict="reject" if app_v else "allow", app=app, gap=gap)

PLAN = [("plain_positive", 600), ("plain_negative", 500), ("hidden_compound", 950), ("misspelling", 600), ("plural", 300), ("case", 250),
        ("unicode", 500), ("foreign_language", 500), ("steps_only", 250), ("declared_only", 200), ("false_positive_trap", 400), ("unknown_allergy", 100)]

def make(kind, rng, k):
    n_neutral = rng.randint(2, 6)
    base = [(x, x) for x in rng.sample(NEUTRAL, n_neutral)]
    target = rng.choice(APP_KEYS)
    extra = sorted(set(rng.sample(APP_KEYS, rng.choice([0, 0, 1, 2]))) - {target})
    profile = sorted({target, *extra}); tricks = []; steps_extra = None; steps_canon = None; declared = None; title = None
    def put(surface, canon):
        base.insert(rng.randint(0, len(base)), (surface, canon))
    if kind == "plain_positive":
        c = rng.choice(DIRECT[target]); put(c, c)
    elif kind == "plain_negative":
        profile = sorted(set(rng.sample(APP_KEYS, rng.randint(1, 3))))
    elif kind == "hidden_compound":
        dish = rng.choice(sorted(EXPANSIONS))
        if rng.random() < 0.25 and dish in ("pad thai", "katsu", "baklava", "gnocchi", "crab rangoon", "miso soup", "naan", "pesto"):
            title = f"Chicken {dish.title()}" if dish not in ("baklava",) else "Baklava bites"; base.append((dish, dish)) if False else None
            canon_title = dish
        else: canon_title = None; put(dish, dish)
        c2, _, _ = ref_keys(dish)
        if c2: profile = sorted({rng.choice(sorted(c2)), *extra})
        if canon_title: steps_canon = [canon_title]
        tricks.append(f"compound:{dish}")
    elif kind == "misspelling":
        c = rng.choice(sorted(MISSPELL)); s = rng.choice(MISSPELL[c]); put(s, c); tricks.append(f"misspelling:{c}->{s}")
        c2, _, _ = ref_keys(c); profile = sorted({rng.choice(sorted(c2)), *extra}) if c2 else profile
    elif kind == "plural":
        sing = rng.choice(sorted(PLURALS)); s = PLURALS[sing]; put(s, f"{sing}, {s}")  # truth = union of both forms; tricks.append(f"plural:{sing}->{s}")
        c2, _, _ = ref_keys(sing); profile = sorted({rng.choice(sorted(c2)), *extra}) if c2 else profile
    elif kind in ("case", "unicode"):
        c = rng.choice(DIRECT[target]); s, op = (trick_case if kind == "case" else trick_unicode)(c, rng); put(s, c); tricks.append(f"{kind}:{op}")
    elif kind == "foreign_language":
        f = rng.choice(sorted(FOREIGN)); c = FOREIGN[f]; put(f, c); tricks.append(f"foreign:{f}->{c}")
        c2, _, _ = ref_keys(c); profile = sorted({rng.choice(sorted(c2)), *extra}) if c2 else profile
    elif kind == "steps_only":
        c = rng.choice(DIRECT[target]); steps_extra = f"Finish with a little {c}."; steps_canon = [c]; tricks.append("allergen_only_in_steps")
    elif kind == "declared_only":
        declared = [target]; tricks.append("declared_allergen_without_text")
    elif kind == "false_positive_trap":
        t = rng.choice(TRAPS); put(t, t); tricks.append(f"trap:{t}")
        profile = sorted(set(rng.sample(APP_KEYS, rng.randint(1, 4))))
    elif kind == "unknown_allergy":
        u = rng.choice(UNKNOWN); profile = sorted({u, *extra})
        if rng.random() < 0.6: put(f"fresh {u}", f"fresh {u}")
        tricks.append(f"unknown_allergy:{u}")
    if rng.random() < 0.3 and kind not in ("declared_only",):  # LLM sometimes declares correctly, often forgets
        c_all = set()
        for _, cc in base: c_all |= ref_keys(cc)[0]
        declared = sorted(c_all) if rng.random() < 0.5 else []
    rec = recipe(rng, base, title=title, steps_extra=steps_extra, declared=declared)
    lab = label(rec, [c for _, c in base], profile, steps_canon=steps_canon, declared=declared)
    return dict(id=f"S{k:05d}", kind=kind, tricks=tricks, profile=dict(allergies=profile), recipe=rec,
                canonical_ingredients=[c for _, c in base] + (steps_canon or []), **lab, synthetic=True)

def main():
    rng = random.Random(SEED3 + 100_000); rows = []
    for kind, n in PLAN:
        for _ in range(n): rows.append(make(kind, rng, len(rows)))
    out = os.path.join(LARGE3, "llm_safety"); jdump(os.path.join(out, "cases.jsonl"), rows)
    meta = dict(app_source="server/src/domain/allergens.ts", expansions=EXPANSIONS, foreign=FOREIGN, misspellings=MISSPELL, plurals=PLURALS,
                traps=TRAPS, note="EXPANSIONS/FOREIGN/MISSPELL are documented assumptions; component labels come from allergens.json via the batch-1 matcher")
    json.dump(meta, open(os.path.join(out, "lookup_tables.json"), "w"), indent=1, ensure_ascii=False)
    ts = os.environ.get("TS_PATH")
    if ts:
        res = subprocess.run(["node", os.path.join(GEN3, "app_allergens_check.mjs")], input="\n".join(json.dumps(r, ensure_ascii=False) for r in rows),
                             capture_output=True, text=True, env=dict(os.environ), check=True).stdout
        got = {j["id"]: j for j in map(json.loads, res.strip().split("\n"))}
        bad = [r["id"] for r in rows if got[r["id"]]["violates"] != r["app"]["violates"] or got[r["id"]]["hits"] != r["app"]["hits"]]
        assert not bad, bad[:10]; print("node cross-check OK", len(got))
    from collections import Counter
    print(len(rows), Counter(r["expected_verdict"] for r in rows), Counter(r["gap"] for r in rows), Counter((r["kind"], r["gap"]) for r in rows if r["gap"]).most_common(14))

if __name__ == "__main__": main()
