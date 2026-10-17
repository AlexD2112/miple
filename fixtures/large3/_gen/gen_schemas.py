"""Emit JSON Schema (draft 2020-12) files for every fixture set in fixtures/, large/, large2/, large3/.
Structure is inferred deterministically from the data (types, required keys present in every record, closed objects,
map-like objects detected by key cardinality), then OVERLAID with hand constraints derived from shelf_life.json and
the app code (category enums, app category enum from schemas.ts, allergen keys from allergens.ts, ISO date patterns).
python3 gen_schemas.py"""
import glob
from core3 import *
from app_allergens import KEYWORDS

SETS = [  # (schema file, [globs relative to fixtures/], jsonl?)
 ("curated.shelf_life", ["shelf_life.json"], False), ("curated.receipt_lines", ["receipt_lines.json"], False),
 ("curated.allergens", ["allergens.json"], False), ("curated.receipts_expected", ["receipts/expected.json"], False),
 ("large.receipts_clean", ["large/receipts/expected_clean.jsonl"], True), ("large.receipts_ocr_noise", ["large/receipts/expected_ocr_noise.jsonl"], True),
 ("large.receipt_lines", ["large/receipt_lines/*.jsonl"], True), ("large.pantry_expiry", ["large/pantry/expiry_cases.jsonl"], True),
 ("large.allergen_cases", ["large/allergens/cases.jsonl"], True), ("large.planner_scenarios", ["large/planner/scenarios.jsonl"], True),
 ("large2.adversarial", ["large2/adversarial/expected.jsonl"], True), ("large2.normalization_pairs", ["large2/normalization/pairs_*.jsonl"], True),
 ("large2.normalization_items", ["large2/normalization/items.jsonl"], True), ("large2.e2e", ["large2/e2e/cases.jsonl"], True),
 ("large2.date_headers", ["large2/dates/header_cases.jsonl"], True), ("large2.date_receipts", ["large2/dates/receipts_expected.jsonl"], True),
 ("large3.llm_safety", ["large3/llm_safety/cases.jsonl"], True), ("large3.llm_lookup_tables", ["large3/llm_safety/lookup_tables.json"], False),
 ("large3.pantry_sequences", ["large3/pantry_sequences/*.jsonl"], True), ("large3.quantity_parsing", ["large3/quantity_parsing/cases.jsonl"], True),
 ("large3.expiry_ranking", ["large3/expiry_ranking/cases.jsonl"], True),
]
MAP_KEYS = 24  # an object whose instances use more distinct keys than this is treated as a map
SHELF_CATS = sorted(CATS); EXTRA = ["non_food", "discount", "deposit", "fee"]
OVERLAY_ENUM = {"category": None, "app_category_key": APP_CATEGORIES + [None], "store": STORES, "expected_storage": ["fridge", "pantry", "freezer"],
                "storage": ["fridge", "pantry", "freezer"], "default_storage": ["fridge", "pantry", "freezer"], "status": ["active", "used", "wasted"],
                "expected_verdict": ["reject", "caution", "allow"], "app_verdict": ["reject", "allow"]}
DATE_KEYS = {"date", "purchase_date", "estimated_expiry", "expected_expiry_date", "today", "business_date", "day"}
ISO_KEYS = {"start", "end"}
ISO = r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$"
DATE = r"^\d{4}-\d{2}-\d{2}$"

def tname(v):
    if v is None: return "null"
    if isinstance(v, bool): return "boolean"
    if isinstance(v, int): return "integer"
    if isinstance(v, float): return "number"
    if isinstance(v, str): return "string"
    if isinstance(v, list): return "array"
    return "object"

class Node:
    def __init__(s): s.types = set(); s.props = {}; s.counts = {}; s.n_obj = 0; s.items = None; s.strs = set(); s.many = False
    def add(s, v):
        t = tname(v); s.types.add(t)
        if t == "object":
            s.n_obj += 1
            for k, x in v.items():
                s.counts[k] = s.counts.get(k, 0) + 1
                s.props.setdefault(k, Node()).add(x)
        elif t == "array":
            if s.items is None: s.items = Node()
            for x in v: s.items.add(x)
        elif t == "string" and not s.many:
            s.strs.add(v)
            if len(s.strs) > 40: s.many = True; s.strs = set()

def emit(node, key=None, cat_enum=None, depth=0):
    ts = sorted(node.types - ({"integer"} if "number" in node.types else set()))
    sch = {"type": ts[0] if len(ts) == 1 else ts}
    if "object" in node.types:
        if len(node.props) > MAP_KEYS:
            merged = Node()
            for p in node.props.values():
                merged.types |= p.types; merged.items = merged.items or p.items
                for k, c in p.props.items(): merged.props.setdefault(k, c)
                merged.counts.update(p.counts); merged.n_obj += p.n_obj; merged.strs |= p.strs; merged.many |= p.many
            sch["additionalProperties"] = emit(merged)
        else:
            sch["properties"] = {k: emit(v, k, cat_enum, depth + 1) for k, v in sorted(node.props.items())}
            sch["required"] = sorted(k for k, c in node.counts.items() if c == node.n_obj)
            sch["additionalProperties"] = False
    if "array" in node.types and node.items is not None and node.items.types:
        sch["items"] = emit(node.items, key, cat_enum, depth)
    if "string" in node.types:
        if key in DATE_KEYS: sch["pattern"] = DATE
        if key in ISO_KEYS: sch["pattern"] = ISO
        if key in OVERLAY_ENUM and not (key == "category" and depth == 1):  # top-level 'category' = case class
            en = OVERLAY_ENUM[key] if OVERLAY_ENUM[key] is not None else cat_enum
            sch["enum"] = sorted([x for x in en if x is not None]) + ([None] if "null" in node.types else [])
    return sch

def load(pattern, jl):
    out = []
    for p in sorted(glob.glob(os.path.join(FIXDIR, pattern))):
        if jl: out.extend(json.loads(l) for l in open(p, encoding="utf-8"))
        else: out.append(json.load(open(p, encoding="utf-8")))
    return out

def main():
    outdir = os.path.join(LARGE3, "schemas"); os.makedirs(outdir, exist_ok=True); manifest = []
    for name, globs, jl in SETS:
        root = Node(); n = 0
        for g in globs:
            for rec in load(g, jl): root.add(rec); n += 1
        cat_enum = SHELF_CATS + EXTRA + (APP_CATEGORIES if name.startswith("large.planner") else [])
        if name == "large3.expiry_ranking": cat_enum = APP_CATEGORIES
        sch = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": f"miple/fixtures/{name}.schema.json",
               "title": name, "description": f"Inferred from {n} record(s) of {', '.join(globs)} + overlays (see _gen/gen_schemas.py)."}
        sch.update(emit(root, None, cat_enum))
        json.dump(sch, open(os.path.join(outdir, f"{name}.schema.json"), "w"), indent=1, sort_keys=True)
        manifest.append(dict(schema=f"{name}.schema.json", files=globs, jsonl=jl, records=n))
    json.dump(dict(sets=manifest, allergen_keys=list(KEYWORDS)), open(os.path.join(outdir, "manifest.json"), "w"), indent=1)
    print(len(manifest), "schemas", sum(m["records"] for m in manifest), "records")

if __name__ == "__main__": main()
