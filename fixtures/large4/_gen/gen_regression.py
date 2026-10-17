"""Allergen regression suite: every batch-3 app gap (fixtures/large3/llm_safety) reduced to the smallest single-term input that
reproduces it, deduplicated and grouped by root cause. Reference = batch-3 rules (allergens.json via batch-1 matcher + the documented
lookup tables in large3/llm_safety/lookup_tables.json). App = port of server/src/domain/allergens.ts.
python3 -B gen_regression.py   (emits allergen_regression/{cases.json, allergens.regression.test.ts})"""
import unicodedata
from collections import defaultdict, Counter
from core4 import *
from app_allergens import KEYWORDS, find_allergens
from gen_llm_safety import ref_keys, EXPANSIONS, FOREIGN, MISSPELL, PLURALS, TRAPS, DIRECT, HOMO

OUT = os.path.join(LARGE4, "allergen_regression")
INV_HOMO = {v: k for k, v in HOMO.items()}
MISS_INV = {s: c for c, ss in MISSPELL.items() for s in ss}

def unicode_clean(s):
    t = unicodedata.normalize("NFKC", s)
    t = "".join(ch for ch in unicodedata.normalize("NFD", t) if unicodedata.category(ch) not in ("Mn", "Cf"))
    return "".join(INV_HOMO.get(ch, ch) for ch in t).replace("\u00a0", " ")

def app_hits(text, a): return bool(find_allergens([text], [a]))
def ref_has(canon, a): return a in ref_keys(canon)[0]

def units(case):
    """(surface, canonical) pairs: ingredients (aligned with canonical_ingredients) + step/title units."""
    ings = case["recipe"]["ingredients"]; can = case["canonical_ingredients"]
    out = [(i["name"], c) for i, c in zip(ings, can)]
    for c in can[len(ings):]:                           # steps_canon: allergen only in a step, or dish only in the title
        for s in case["recipe"]["steps"] + [case["recipe"]["title"]]:
            if c.lower() in unicode_clean(s).lower(): out.append((s, c)); break
    return out

def classify_fn(surface, canon, a):
    """Return (root_cause, minimized_text, why) for a false negative unit."""
    forms = [x.strip() for x in canon.split(",")] if canon not in EXPANSIONS else [canon]
    s_low = surface.lower()
    if unicode_clean(surface) != surface and app_hits(unicode_clean(surface), a):
        return "unicode_normalization", minimize_unicode(surface.strip(), a), f"{unicode_op(surface)}: app matches after NFKC + stripping format/combining chars + confusable map"
    if s_low in FOREIGN: return "foreign_terms", s_low, f"lookup_tables.foreign: {s_low} -> {FOREIGN[s_low]}"
    if s_low in MISS_INV and app_hits(MISS_INV[s_low], a): return "misspellings", s_low, f"lookup_tables.misspellings: {s_low} -> {MISS_INV[s_low]}"
    # surface is a step/title sentence: shrink to the canonical term when the app still misses it
    for f in forms:
        if ref_has(f, a) and not app_hits(f, a):
            base = f.lower()
            if base in EXPANSIONS: return "compound_dishes", base, f"lookup_tables.expansions: {base} -> {', '.join(EXPANSIONS[base])}"
            sing = {v: k for k, v in PLURALS.items()}.get(base)
            if sing and app_hits(sing, a): return "plurals", base, f"singular '{sing}' matches; plural '{base}' does not"
            if base.endswith("s") and app_hits(base[:-1], a): return "plurals", base, f"singular '{base[:-1]}' matches; '{base}' does not (compound word boundary)"
            return "missing_keyword", base, "no app keyword covers this term"
    if s_low in MISS_INV: return "misspellings", s_low, f"lookup_tables.misspellings: {s_low} -> {MISS_INV[s_low]}"
    return None

# FP minimization may only shrink a documented trap to a sub-phrase that is itself documented-safe (never to a bare generic term)
TRAPS_SAFE = set(TRAPS) | {"almond-free pesto", "peanut-free", "dairy-free butter", "sunflower seed butter", "coconut yogurt"}
# batch-3 trap labels we no longer stand behind: soba/buckwheat noodles are very often made with wheat flour
DISPUTED = {("wheat", "buckwheat noodles"), ("gluten", "buckwheat noodles")}
UNI_OPS = [("zero_width", "\u200b"), ("soft_hyphen", "\u00ad"), ("nbsp", "\u00a0"), ("combining_mark", "\u0301")]
def unicode_op(s):
    for op, ch in UNI_OPS:
        if ch in s: return op
    if any(0xFF01 <= ord(c) <= 0xFF5E for c in s): return "fullwidth"
    if any(c in INV_HOMO for c in s): return "homoglyph_cyrillic"
    return "precomposed_accent"

def minimize_unicode(surface, a):
    words = surface.split(" ")
    for i in range(len(words)):
        if len(words) == 1: break
        for j in range(len(words)):
            cand = " ".join(words[:j] + words[j + 1:])
            if cand and cand != " ".join(words) and ref_has(unicode_clean(cand), a) and not app_hits(cand, a) and unicode_op(cand) == unicode_op(surface):
                words = words[:j] + words[j + 1:]; break
    return " ".join(words).lower() if unicode_op(surface) != "fullwidth" else " ".join(words)

def minimize_fp(surface, a):
    """Greedy word deletion keeping: app matches `a` AND reference says the text does not contain `a`."""
    words = surface.split()
    changed = True
    while changed and len(words) > 1:
        changed = False
        for i in range(len(words)):
            cand = " ".join(words[:i] + words[i + 1:])
            if cand in TRAPS_SAFE and app_hits(cand, a):
                words = words[:i] + words[i + 1:]; changed = True; break
    return " ".join(words).lower()

def main():
    cases = [json.loads(l) for l in open(os.path.join(FIXDIR, "large3", "llm_safety", "cases.jsonl"), encoding="utf-8")]
    groups = defaultdict(dict); unresolved = []; silent = {}; disputed = {}
    for c in cases:
        if not c["gap"]: continue
        prof = c["profile"]["allergies"]; found = False
        if c["gap"] == "app_false_negative":
            for a in [x for x in prof if x in c["offending"]]:
                for s, can in units(c):
                    if ref_has(can, a) and not app_hits(s, a):
                        r = classify_fn(s, can, a)
                        if not r: continue
                        cause, text, why = r; found = True
                        e = groups[cause].setdefault((a, text), dict(text=text, allergy=a, expected=[a], app_current=[], why=why, source_cases=[]))
                        e["source_cases"].append(c["id"])
        else:
            for a in c["app"]["hits"]:
                for s, can in units(c):
                    if app_hits(s, a) and not ref_has(can, a):
                        found = True
                        if can not in TRAPS:   # allergens.json is merely silent (e.g. generic bread/noodles/tortillas): app is conservatively right
                            silent.setdefault((a, can), set()).add(c["id"]); continue
                        if (a, can) in DISPUTED: disputed.setdefault((a, can), set()).add(c["id"]); continue
                        text = minimize_fp(s, a)
                        e = groups["over_broad_terms"].setdefault((a, text), dict(text=text, allergy=a, expected=[], app_current=[a],
                                     why=f"app keyword {sorted(set(m.lower() for m in find_allergens([text],[a],True)[1][a]))} matches inside a term that does not contain {a} (reference: allergens.json)",
                                     source_cases=[]))
                        e["source_cases"].append(c["id"])
        if not found: unresolved.append(c["id"])
    # controls: terms the app gets right today, so fixes don't regress them
    controls = []
    for a, terms in DIRECT.items():
        for t in terms:
            if app_hits(t, a) and ref_has(t, a): controls.append(dict(text=t, allergy=a, expected=[a], app_current=[a]))
    for t in TRAPS:
        for a in KEYWORDS:
            if not app_hits(t, a) and not ref_has(t, a) and a in ("milk", "tree_nut", "peanut", "wheat", "gluten", "egg"):
                controls.append(dict(text=t, allergy=a, expected=[], app_current=[])); break
    uni = groups.pop("unicode_normalization", {}); best = {}
    for (a, text), e in uni.items():
        k = (a, e["why"].split(":")[0]); cur = best.get(k)
        if cur is None or (len(e["text"]), e["text"]) < (len(cur["text"]), cur["text"]):
            if cur: e["source_cases"] += cur["source_cases"]; e["variants"] = cur.get("variants", 1) + 1
            best[k] = e
        else: cur["source_cases"] += e["source_cases"]; cur["variants"] = cur.get("variants", 1) + 1
    groups["unicode_normalization"] = {(e["allergy"], e["text"]): e for e in best.values()}
    ORDER = ["plurals", "misspellings", "unicode_normalization", "foreign_terms", "compound_dishes", "missing_keyword", "over_broad_terms"]
    out = dict(source="fixtures/large3/llm_safety/cases.jsonl", app_source="server/src/domain/allergens.ts", synthetic=True,
               rule="each case: findAllergens([text], [allergy]) should equal `expected`; `app_current` is what it returns today",
               groups=[], controls=controls, unresolved_source_cases=unresolved,
               reference_silent=[dict(allergy=a, canonical=c, source_case_count=len(v), source_cases=sorted(v)[:5],
                                      note="batch-3 labelled app_false_positive only because allergens.json has no entry; app behaviour is conservative and NOT a regression")
                                 for (a, c), v in sorted(silent.items())],
               reference_disputed=[dict(allergy=a, canonical=c, source_case_count=len(v), source_cases=sorted(v)[:5],
                                        note="batch-3 trap label withdrawn: commonly contains wheat; keep the app's conservative match")
                                   for (a, c), v in sorted(disputed.items())])
    n = 0
    for g in ORDER:
        rows = sorted(groups.get(g, {}).values(), key=lambda e: (e["allergy"], e["text"]))
        for i, e in enumerate(rows):
            e["id"] = f"{g}-{i:03d}"; e["source_case_count"] = len(e["source_cases"]); e["source_cases"] = sorted(set(e["source_cases"]))[:5]
            # sanity: app_current reproduces with the port
            assert find_allergens([e["text"]], [e["allergy"]]) == e["app_current"], e
        out["groups"].append(dict(root_cause=g, cases=rows)); n += len(rows)
    os.makedirs(OUT, exist_ok=True)
    json.dump(out, open(os.path.join(OUT, "cases.json"), "w"), indent=1, ensure_ascii=False)
    write_test(out)
    print("cases", n, {g["root_cause"]: len(g["cases"]) for g in out["groups"]}, "controls", len(controls), "unresolved", len(unresolved), "reference_silent", len(silent))

def tsstr(s): return json.dumps(s, ensure_ascii=True)  # \\u escapes keep invisible chars visible in review
def write_test(out):
    L = ["// Allergen regression suite generated from fixtures/large4/allergen_regression/cases.json (synthetic).",
         "// Drop next to server/src/domain/allergens.ts. Known gaps are `todo` (reported, never fail CI); flip a group to a",
         "// normal test once its fix lands. Controls are normal tests that must keep passing.",
         'import assert from "node:assert/strict";', 'import { describe, test } from "node:test";', 'import { findAllergens } from "./allergens.js";', "",
         "type Case = { id: string; text: string; allergy: string; expected: string[] };", ""]
    for g in out["groups"]:
        L.append(f"const {g['root_cause'].upper()}: Case[] = [")
        for e in g["cases"]: L.append(f"  {{ id: {tsstr(e['id'])}, text: {tsstr(e['text'])}, allergy: {tsstr(e['allergy'])}, expected: {json.dumps(e['expected'])} }},")
        L.append("];")
    L.append("const CONTROLS: Case[] = [")
    for i, e in enumerate(out["controls"]): L.append(f"  {{ id: \"control-{i:03d}\", text: {tsstr(e['text'])}, allergy: {tsstr(e['allergy'])}, expected: {json.dumps(e['expected'])} }},")
    L += ["];", "", "const KNOWN_GAPS: Record<string, Case[]> = {"] + [f"  {g['root_cause']}: {g['root_cause'].upper()}," for g in out["groups"]] + ["};", "",
          "for (const [cause, cases] of Object.entries(KNOWN_GAPS)) {",
          "  describe(`allergen regression: ${cause}`, () => {",
          "    for (const c of cases) {",
          "      test(`${c.id} ${JSON.stringify(c.text)} / ${c.allergy}`, { todo: `known gap (${cause})` }, () => {",
          "        assert.deepEqual(findAllergens([c.text], [c.allergy]), c.expected);",
          "      });", "    }", "  });", "}", "",
          'describe("allergen regression: controls", () => {', "  for (const c of CONTROLS) {",
          "    test(`${c.id} ${JSON.stringify(c.text)} / ${c.allergy}`, () => {",
          "      assert.deepEqual(findAllergens([c.text], [c.allergy]), c.expected);", "    });", "  }", "});", ""]
    open(os.path.join(OUT, "allergens.regression.test.ts"), "w").write("\n".join(L))

if __name__ == "__main__": main()
