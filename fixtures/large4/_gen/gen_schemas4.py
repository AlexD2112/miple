"""JSON Schemas for the new large4 sets, using the same inference + overlay method as large3/_gen/gen_schemas.py (imported read-only).
python3 -B gen_schemas4.py"""
from core4 import *
import gen_schemas as G

SETS = [("large4.allergen_regression", ["large4/allergen_regression/cases.json"], False),
        ("large4.ocr_vision", ["large4/ocr_vision/receipts_*.jsonl"], True),
        ("large4.calendar_windows", ["large4/calendar_windows/cases.jsonl"], True),
        ("large4.unit_conversion", ["large4/unit_conversion/cases.jsonl"], True),
        ("large4.unit_constants", ["large4/unit_conversion/constants.json"], False),
        ("large4.household", ["large4/household/cases.jsonl"], True)]
ISO_MS = r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}([+-]\d{2}:\d{2}|Z)$"
EXTRA_ENUM = {"availability": ["busy", "free", "tentative", "unavailable", "notSupported"], "meal": ["lunch", "dinner"],
              "calendar_access": ["granted", "denied", "read_error"], "line_type": ["sale", "discount", "fee", "deposit", "return"],
              "root_cause": ["plurals", "misspellings", "unicode_normalization", "foreign_terms", "compound_dishes", "missing_keyword", "over_broad_terms"]}
STATUS = {"large4.unit_conversion": ["ok", "incompatible_dimension", "unknown_unit", "invalid_quantity"],
          "large4.household": ["accepted", "rejected_over_return", "unmatched"]}

def main():
    outdir = os.path.join(LARGE4, "schemas"); os.makedirs(outdir, exist_ok=True); manifest = []
    G.DATE_KEYS |= {"purchased_at", "original_date_printed"}
    G.ISO_KEYS = {"start", "end", "now", "startDate", "endDate"}; G.ISO = ISO_MS
    base_overlay = dict(G.OVERLAY_ENUM)
    for name, globs, jl in SETS:
        G.OVERLAY_ENUM.clear(); G.OVERLAY_ENUM.update(base_overlay); G.OVERLAY_ENUM.update(EXTRA_ENUM)
        if name in STATUS: G.OVERLAY_ENUM["status"] = STATUS[name]
        else: G.OVERLAY_ENUM.pop("status", None)
        if name == "large4.household": G.OVERLAY_ENUM.pop("store", None)   # rescans print the store name in other casings on purpose
        root = G.Node(); n = 0
        for g in globs:
            for rec in G.load(g, jl): root.add(rec); n += 1
        sch = {"$schema": "https://json-schema.org/draft/2020-12/schema", "$id": f"miple/fixtures/{name}.schema.json", "title": name,
               "description": f"Inferred from {n} record(s) of {', '.join(globs)} + overlays (see _gen/gen_schemas4.py)."}
        sch.update(G.emit(root, None, G.SHELF_CATS + G.EXTRA + ["return"]))
        json.dump(sch, open(os.path.join(outdir, f"{name}.schema.json"), "w"), indent=1, sort_keys=True)
        manifest.append(dict(schema=f"{name}.schema.json", files=globs, jsonl=jl, records=n))
    # large3 sub-schemas that also apply to large4 records (same shape)
    applies = [dict(schema="../../large3/schemas/large.receipts_clean.schema.json", pointer="properties/items/items",
                    files=["large4/ocr_vision/receipts_*.jsonl"], jsonl=True, record_path="ground_truth/items/*")]
    json.dump(dict(sets=manifest, large3_schemas_applied=applies), open(os.path.join(outdir, "manifest.json"), "w"), indent=1)
    print(len(manifest), "schemas", sum(x["records"] for x in manifest), "records")

if __name__ == "__main__": main()
