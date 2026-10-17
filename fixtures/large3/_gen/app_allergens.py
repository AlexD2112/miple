"""Faithful Python port of server/src/domain/allergens.ts (findAllergens / violatesAllergies).
The keyword table is parsed from the TypeScript source at import time, so labels follow the app code exactly.
JS semantics reproduced: haystack = texts.join(" \\n ").toLowerCase(); /\\b(words)(e?s)?\\b/i with ASCII word boundaries."""
import os, re
from core3 import REPO
TS = open(os.path.join(REPO, "server", "src", "domain", "allergens.ts")).read()
_body = TS.split("ALLERGEN_KEYWORDS: Record<string, string[]> = {", 1)[1].split("};", 1)[0]
KEYWORDS = {k: re.findall(r'"([^"]+)"', v) for k, v in re.findall(r"(\w+):\s*\[(.*?)\]", _body, re.S)}
assert len(KEYWORDS) == 10 and "pesto" in KEYWORDS["tree_nut"], KEYWORDS.keys()
def _pat(words): return re.compile(r"\b(" + "|".join(map(re.escape, words)) + r")(e?s)?\b", re.I | re.A)
PATTERNS = {k: _pat(v) for k, v in KEYWORDS.items()}

def find_allergens(texts, allergies, with_terms=False):
    hay = " \n ".join(texts).lower(); hits, terms = [], {}
    for a in allergies:
        key = a.lower().strip()
        p = PATTERNS.get(key) or re.compile(r"\b" + re.escape(key) + r"(e?s)?\b", re.I | re.A)
        ms = [m.group(0) for m in p.finditer(hay)]
        if ms: hits.append(key); terms[key] = sorted(set(ms))
    return (hits, terms) if with_terms else hits

def violates(recipe, allergies):
    if not allergies: return False, "no_allergies"
    declared = [a.lower() for a in (recipe.get("declared_allergens") or [])]
    if any(a.lower() in declared for a in allergies): return True, "declared"
    texts = [recipe["title"]] + [i["name"] for i in recipe["ingredients"]] + list(recipe.get("steps") or [])
    return (len(find_allergens(texts, allergies)) > 0), "text"
