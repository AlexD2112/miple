"""Reference allergen matcher used to LABEL fixtures/large allergen cases. Rules are derived only from
../../allergens.json (terms, may_contain, not_this_allergen, fda_excluded_since_2025, mollusks_optional,
cross_reactive_not_major, notes). Documented in ../README.md ("Allergen labeling rules" R1-R9)."""
import re, json, os
FIX = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AJ = json.load(open(os.path.join(FIX, "allergens.json")))
APP_KEY = {"milk": "milk", "eggs": "egg", "fish": "fish", "crustacean shellfish": "shellfish", "tree nuts": "tree_nut",
           "peanuts": "peanut", "wheat": "wheat", "soy": "soy", "sesame": "sesame"}

def clean_term(t):
    t = re.sub(r"\(.*?\)", "", t.lower()).replace("?", "")
    return [norm(p) for p in t.split("/") if norm(p)]
def norm(s):
    s = s.lower().replace("\u2019", "'").replace("\u00e9", "e").replace("\u00e8", "e").replace("\u00f1", "n")
    s = re.sub(r"[,;.:()\[\]]", " | ", s)  # list separators stop qualifier look-back (R6)
    s = re.sub(r"[^a-z0-9'_| ]+", " ", s.replace("-", " "))
    return re.sub(r"\s+", " ", s).strip()
def terms_of(lst): return sorted({c.replace("|", " ").strip() for t in lst for c in clean_term(t)} - {""}, key=lambda x: (-len(x), x))

A = {}
for a in AJ["allergens"]:
    A[a["allergen"]] = dict(terms=terms_of(a["terms"]), may=terms_of(a.get("may_contain", [])), traps=terms_of(a.get("not_this_allergen", [])),
                            excluded=terms_of(a.get("fda_excluded_since_2025", [])), mollusks=terms_of(a.get("mollusks_optional", [])),
                            cross=terms_of(a.get("cross_reactive_not_major", [])))
# R6: plant / free-from qualifiers (from milk + wheat notes in allergens.json): a term is NOT a match when the word right before it
# names another source. Tokens free_<key> come from free-from claims (R3).
PLANT = {"coconut", "oat", "almond", "soy", "rice", "cashew", "hemp", "pea", "macadamia", "hazelnut", "flax", "vegan", "plant", "nut"}
QUAL = {"milk": PLANT | {"free_milk"}, "cream": PLANT | {"free_milk"}, "cheese": PLANT | {"free_milk"}, "yogurt": PLANT | {"free_milk"},
        "ice cream": PLANT | {"free_milk"},
        "butter": {"peanut", "almond", "cashew", "sunflower", "seed", "nut", "apple", "shea", "cocoa", "soy", "sesame", "pumpkin",
                   "hazelnut", "pecan", "pistachio", "macadamia", "walnut", "free_milk", "vegan", "plant"},
        "flour": {"rice", "corn", "oat", "almond", "coconut", "buckwheat", "chickpea", "tapioca", "potato", "cassava", "sorghum",
                  "millet", "teff", "amaranth", "quinoa", "soy", "sesame", "peanut", "banana", "chestnut", "arrowroot", "lentil",
                  "pea", "rye", "barley", "lupin", "free_wheat"},
        "pasta": {"lupin", "rice", "chickpea", "lentil", "corn", "quinoa", "bean", "konjac", "free_wheat"},
        "starch": {"corn", "potato", "tapioca", "rice", "pea", "arrowroot"}, "lecithin": {"soy", "sunflower", "canola"}}
# R3: free-from claims -> token. 'lactose-free' is NOT a milk-free claim (lactose-free milk is still milk).
CLAIMS = [("tree nut", ["tree nuts"]), ("peanut", ["peanuts"]), ("nut", ["tree nuts", "peanuts"]), ("dairy", ["milk"]), ("milk", ["milk"]),
          ("egg", ["eggs"]), ("gluten", ["wheat"]), ("wheat", ["wheat"]), ("soy", ["soy"]), ("sesame", ["sesame"]),
          ("fish", ["fish"]), ("shellfish", ["crustacean shellfish"])]
PAL = re.compile(r"(may (?:also )?contain|(?:produced|processed|made|manufactured) (?:in a facility|on (?:shared )?equipment) (?:that|which)? ?(?:also )?(?:processes|handles|with)?|made on shared equipment with)\s*:?\s*([^.;]*)", re.I)

def wre(term): return re.compile(r"(?<![a-z0-9_'])" + re.escape(term) + r"(?:s|es)?(?![a-z0-9_])")  # R1 whole word, simple plural
RX = {}
def rx(t):
    if t not in RX: RX[t] = wre(t)
    return RX[t]

ANY = {}
def anyrx(a, field):
    k = (a, field)
    if k not in ANY:
        ts = A[a][field]
        ANY[k] = re.compile(r"(?<![a-z0-9_'])(?:" + "|".join(map(re.escape, ts)) + r")(?:s|es)?(?![a-z0-9_])") if ts else None
    return ANY[k]
def some(a, field, text, blocked=()):
    r = anyrx(a, field)
    if r is None or not r.search(text): return []
    return [x for x in A[a][field] if find(x, text, blocked)]

def spans(traps, text):
    return [m.span() for tr in traps for m in rx(tr).finditer(text)]

def find(term, text, blocked=()):
    for m in rx(term).finditer(text):
        if any(a < m.end() and m.start() < b for a, b in blocked): continue  # R4 inside a not_this_allergen phrase
        before = text[:m.start()].split()
        prev = before[-1] if before else ""
        if term in QUAL and prev in QUAL[term]: continue
        return True
    return False

def prep(raw):
    t = raw.lower()
    t = re.sub(r"tree nuts?\s*\(\s*coconut\s*\)", "coconut", t)  # R7 legacy labels
    pal = " ; ".join(m.group(2) for m in PAL.finditer(t)); t = PAL.sub(" ; ", t)
    claimed = set()
    def claim(m):
        w = norm(m.group(1))
        for k, als in CLAIMS:
            if w == k or w.endswith(" " + k):
                claimed.update(als); return " " + " ".join("free_" + APP_KEY[a] for a in als) + " "
        return " "
    t = re.sub(r"\b((?:tree )?[a-z]+)[- ]free\b", claim, t)
    t = re.sub(r"\b(?:free (?:of|from)|made without|contains no|does not contain)\s+[^.;:]*", lambda m: " ".join(
        "free_" + APP_KEY[a] for k, als in CLAIMS if k in m.group(0) for a in als) + " ; ", t)
    return norm(t), norm(pal), claimed

def analyze(name, ingredients=None):
    text, pal, claimed = prep((name or "") + " . " + (ingredients or ""))
    out = dict(contains=[], may_contain=[], fda_excluded_tree_nuts=[], mollusks=[], cross_reactive=[], matched_terms={}, traps_hit=[])
    for a, R in A.items():
        t = text
        tr_hit = some(a, "traps", t)
        blk = spans(tr_hit, t)
        out["traps_hit"] += tr_hit
        neg = "free_" + APP_KEY[a]
        hits = [x for x in some(a, "terms", t, blk) if not re.search(neg + r" " + re.escape(x) + r"(?:s|es)?(?![a-z0-9_])", t)]
        if hits: out["contains"].append(a); out["matched_terms"][a] = hits
        elif a not in claimed and ((pal and some(a, "terms", pal, spans(some(a, "traps", pal), pal))) or some(a, "may", t, blk)):
            out["may_contain"].append(a)  # R5 precautionary / R8 claim suppresses may_contain only
        blk_x = spans([x for x in tr_hit if x not in R["excluded"]], t)
        out["fda_excluded_tree_nuts"] += some(a, "excluded", t, blk_x)
        out["mollusks"] += some(a, "mollusks", t, blk)
        out["cross_reactive"] += some(a, "cross", t, blk)
    for k in ("fda_excluded_tree_nuts", "mollusks", "cross_reactive", "traps_hit"): out[k] = sorted(set(out[k]))
    out["app_keys"] = sorted(APP_KEY[a] for a in out["contains"])
    return out
