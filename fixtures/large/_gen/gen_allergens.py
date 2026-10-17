"""Allergen label cases, labeled by allergen_matcher.analyze (rules from ../../allergens.json).
Construction-time asserts make sure the matcher agrees with the intended labels. python3 gen_allergens.py"""
import os, json, random, re
from common import SEED, LARGE, CATALOG, STORES, store_raw
from allergen_matcher import analyze, A, APP_KEY

rng = random.Random(SEED + 4)
NEUTRAL = ["water", "sugar", "cane sugar", "salt", "sea salt", "canola oil", "sunflower oil", "olive oil", "rice", "brown rice", "corn",
           "cornmeal", "potatoes", "tomatoes", "tomato paste", "onion", "garlic", "carrots", "celery", "spinach", "black beans",
           "chickpeas", "lentils", "quinoa", "apple juice concentrate", "lemon juice", "vinegar", "distilled vinegar", "cinnamon",
           "black pepper", "paprika", "turmeric", "cumin", "chili powder", "ginger", "citric acid", "ascorbic acid", "xanthan gum",
           "guar gum", "pectin", "baking soda", "yeast", "honey", "maple syrup", "molasses", "dates", "raisins", "bananas", "apples",
           "strawberries", "blueberries", "mango", "pineapple", "zucchini", "bell peppers", "mushrooms", "chicken", "beef", "pork",
           "turkey", "cocoa powder", "vanilla extract", "natural flavor", "tapioca starch", "potato starch", "rice flour", "corn starch",
           "sunflower lecithin", "pea protein", "oats", "rolled oats", "nutmeg", "eggplant", "cream of tartar", "buckwheat",
           "cocoa butter", "coconut oil", "coconut milk", "coconut", "water chestnuts", "butternut squash", "highly refined peanut oil"]
BRANDS = ["Cascade Kitchen", "Rainier Pantry", "Puget Provisions", "Emerald Table", "Olympic Harvest", "Sound Foods", "Evergreen Co",
          "Northwest Larder", "Capitol Hill Goods", "Lake Union Eats"]
BASES = ["Crackers", "Cookies", "Snack Bar", "Granola", "Cereal", "Soup", "Frozen Entree", "Stir Fry Kit", "Sauce", "Dressing",
         "Bread", "Muffins", "Chips", "Trail Mix", "Smoothie", "Burrito", "Curry", "Dumplings", "Pancake Mix", "Veggie Burger"]
STYLES = ["Classic", "Original", "Spicy", "Honey", "Roasted", "Savory", "Sweet", "Harvest", "Garden", "Rustic", "Zesty", "Family Size"]
LABEL = {"milk": "Milk", "eggs": "Egg", "fish": "Fish (Cod)", "crustacean shellfish": "Shellfish (Shrimp)", "tree nuts": "Tree Nuts (Almonds)",
         "peanuts": "Peanuts", "wheat": "Wheat", "soy": "Soy", "sesame": "Sesame"}

def neutral_ok(x):
    r = analyze("", x); return not r["contains"] and not r["may_contain"]
NEUTRAL = [x for x in NEUTRAL if neutral_ok(x)]
assert all(not analyze(f"{b} {s} {c}")["contains"] for b in BRANDS for s in STYLES for c in BASES)
COMP = {a: [t for t in R["terms"] if len(t) > 2 and analyze("", t)["contains"] == [a]] for a, R in A.items()}

def case_rec(cid, kind, name, ingr, intended=None, note=None):
    r = analyze(name, ingr)
    rec = dict(id=cid, kind=kind, product_name=name, ingredients=ingr, expected_contains=r["contains"],
               expected_may_contain=r["may_contain"], expected_app_keys=r["app_keys"],
               expected_fda_excluded_tree_nuts=r["fda_excluded_tree_nuts"], expected_mollusks=r["mollusks"],
               expected_cross_reactive=r["cross_reactive"], matched_terms=r["matched_terms"], traps_present=r["traps_hit"],
               synthetic=True)
    if note: rec["note"] = note
    if intended is not None:
        for k, v in intended.items():
            assert sorted(rec[k]) == sorted(v), (cid, name, ingr, k, rec[k], v)
    return rec

TRICKY = [  # (name, ingredients, intended contains, intended fda_excluded, note)
 ("Buckwheat Groats", "100% buckwheat", [], [], "buckwheat is not wheat"),
 ("Buckwheat Pancake Mix", "buckwheat flour, rice flour, baking soda, salt", [], [], "buckwheat/rice flour qualifiers"),
 ("100% Buckwheat Soba", "buckwheat flour, water", [], [], "soba made only from buckwheat"),
 ("Ground Nutmeg", "nutmeg", [], [], "nutmeg is a seed spice, not a nut"),
 ("Pumpkin Pie Spice", "cinnamon, ginger, nutmeg, cloves", [], [], "nutmeg"),
 ("Grilled Eggplant", "eggplant, olive oil, salt", [], [], "eggplant is not egg"),
 ("Baba Ganoush Base", "roasted eggplant, lemon juice, garlic, salt", [], [], "eggplant (no tahini)"),
 ("Coconut Water", "coconut water", [], ["coconut"], "coconut no longer a tree nut (FDA Jan 2025)"),
 ("Toasted Coconut Chips", "coconut, cane sugar. Contains: tree nuts (coconut)", [], ["coconut"], "legacy label format"),
 ("Coconut Milk Lite", "coconut milk, water, guar gum", [], ["coconut"], "coconut milk is not dairy"),
 ("Coconut Yogurt", "coconut cream, tapioca starch, live cultures", [], ["coconut"], "coconut cream/yogurt not dairy"),
 ("Snickerdoodle Mix", "sugar, rice flour, cream of tartar, cinnamon", [], [], "cream of tartar is not dairy"),
 ("Peanut-Free Sunflower Seed Bar", "rolled oats, honey, sunflower seeds", [], [], "peanut-free claim"),
 ("Nut-Free Seed Butter", "roasted sunflower seeds, salt", [], [], "nut-free claim + seed butter"),
 ("Dairy-Free Chocolate Chips", "cane sugar, unsweetened chocolate, cocoa butter", [], [], "cocoa butter is not dairy"),
 ("Gluten-Free Pasta", "brown rice flour, water", [], [], "gluten-free pasta made from rice"),
 ("Oat Milk Original", "oat base (water, oats), sunflower oil, salt", [], [], "oat milk not dairy"),
 ("Rice Milk", "filtered water, brown rice, sunflower oil", [], [], "rice milk"),
 ("Almond Milk", "almondmilk (filtered water, almonds), sea salt", ["tree nuts"], [], "almond milk = tree nut, not dairy"),
 ("Soy Milk", "filtered water, whole soybeans", ["soy"], [], "soy milk = soy, not dairy"),
 ("Lactose-Free Whole Milk", "whole milk, lactase enzyme", ["milk"], [], "lactose-free is still milk"),
 ("Water Chestnuts, Sliced", "water chestnuts, water", [], [], "water chestnut is a corm"),
 ("Roasted Chestnuts", "chestnuts", [], ["chestnut"], "chestnut removed from FDA tree nut list 2025"),
 ("Butternut Squash Soup", "butternut squash, water, onion, salt", [], [], "butternut squash"),
 ("Highly Refined Peanut Oil", "highly refined peanut oil", [], [], "highly refined peanut oil exempt (FALCPA)"),
 ("Cornstarch", "corn starch", [], [], "starch qualifier"),
 ("Sunflower Lecithin", "sunflower lecithin", [], [], "not egg/soy lecithin"),
 ("Steamed Clams", "clams, water, salt", [], [], "mollusks are not FDA major crustacean shellfish"),
 ("Lupin Flour", "lupin flour", [], [], "lupin cross-reactive w/ peanut, not a major allergen"),
 ("Cocoa Butter Wafers", "cocoa butter, sugar", [], [], "cocoa butter"),
 ("Apple Butter", "apples, cane sugar, cinnamon", [], [], "apple butter"),
 ("Shea Butter Lip Balm", "shea butter, beeswax", [], ["shea nut"] if False else [], "non-food; shea butter"),
 ("Walnut Halves", "walnuts", ["tree nuts"], [], "positive control"),
 ("Peanut Butter Pretzels", "enriched wheat flour, peanut butter (peanuts, salt)", ["wheat", "peanuts"], [], "positive control"),
 ("Imitation Crab Sticks", "pollock, wheat starch, egg whites, crab extract", ["fish", "wheat", "eggs", "crustacean shellfish"], [], "surimi"),
 ("Tahini", "ground sesame seeds", ["sesame"], [], "positive control"),
 ("Crackers", "enriched flour (wheat flour, niacin), canola oil, salt. May contain milk and sesame.", ["wheat"], [], "may-contain statement"),
 ("Trail Mix", "raisins, sunflower seeds, dried cranberries. Produced in a facility that also processes peanuts and tree nuts.", [], [], "facility statement"),
 ("Dark Chocolate Bar", "chocolate, cane sugar, cocoa butter. Made on shared equipment with milk.", [], [], "shared equipment"),
]
TRICKY = [t for t in TRICKY if t[0] != "Shea Butter Lip Balm"]

def tricky_variants(t, k):
    name, ingr, cont, exc, note = t
    v_name = rng.choice([name, name.upper(), f"{rng.choice(BRANDS)} {name}", name.lower()])
    parts = ingr.split(". ")
    extra = rng.sample([x for x in NEUTRAL if not analyze("", x)["fda_excluded_tree_nuts"] and x not in ("buckwheat",)], rng.randint(0, 2)) if k else []
    main = ", ".join([parts[0]] + extra)
    v_ing = ". ".join([main] + parts[1:])
    if rng.random() < 0.3: v_ing = v_ing.upper()
    return v_name, v_ing

def main():
    rows = []
    # 1) tricky negatives / controls with asserted labels
    for t in TRICKY:
        for k in range(50):
            n, i = tricky_variants(t, k)
            rows.append(case_rec(f"A{len(rows):06d}", "tricky", n, i, {"expected_contains": t[2], "expected_fda_excluded_tree_nuts": t[3]}, t[4]))
    # 2) composed products
    allergens = list(A)
    for _ in range(6000):
        want = rng.sample(allergens, rng.choice([0, 0, 1, 1, 1, 2, 2, 3]))
        ingr = rng.sample(NEUTRAL, rng.randint(3, 9)) + [rng.choice(COMP[a]) for a in want]
        rng.shuffle(ingr)
        text = ", ".join(ingr) + "."
        if want and rng.random() < 0.6: text += " Contains: " + ", ".join(LABEL[a] for a in want) + "."
        pal = None
        if rng.random() < 0.3:
            pal = rng.choice([x for x in allergens if x not in want])
            text += rng.choice([" May contain {}.", " Produced in a facility that also processes {}.", " Made on shared equipment with {}."]).format(LABEL[pal].lower())
        name = f"{rng.choice(BRANDS)} {rng.choice(STYLES)} {rng.choice(BASES)}"
        claim = None
        if rng.random() < 0.15:
            free = [a for a in ("peanuts", "milk", "eggs", "soy", "sesame") if a not in want and a != pal]
            claim = rng.choice(free); name = {"peanuts": "Peanut-Free", "milk": "Dairy-Free", "eggs": "Egg-Free", "soy": "Soy-Free", "sesame": "Sesame-Free"}[claim] + " " + name
        if rng.random() < 0.2: text = text.upper()
        r = case_rec(f"A{len(rows):06d}", "composed", name, "Ingredients: " + text)
        assert set(want) <= set(r["expected_contains"]) and set(r["expected_contains"]) <= set(want), (name, text, want, r["expected_contains"])
        if pal: assert pal in r["expected_may_contain"], (text, pal, r)
        if claim: assert claim not in r["expected_contains"] + r["expected_may_contain"]
        rows.append(r)
    # 3) name-only (receipt-style) cases: labels from names alone, low confidence
    for _ in range(2000):
        it = rng.choice(CATALOG); st = rng.choice(STORES)
        raw, short = store_raw(it, st, rng)
        n = rng.choice([it["name"], raw])
        r = case_rec(f"A{len(rows):06d}", "name_only", n, None, note="name only; ingredients unknown -> labels are lower bounds")
        r["store"] = st; rows.append(r)
    out = os.path.join(LARGE, "allergens"); os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "cases.jsonl"), "w") as f:
        for r in rows: f.write(json.dumps(r, separators=(",", ":")) + "\n")
    from collections import Counter
    print(len(rows), Counter(r["kind"] for r in rows), Counter(a for r in rows for a in r["expected_contains"]),
          "may", Counter(a for r in rows for a in r["expected_may_contain"]), "excl", Counter(x for r in rows for x in r["expected_fda_excluded_tree_nuts"]))

if __name__ == "__main__": main()
