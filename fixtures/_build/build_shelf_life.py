import os
"""Build fixtures/shelf_life.json strictly from the FoodKeeper JSON (no invented numbers).
Each category lists FoodKeeper citations: (product_id, field_abbrev, slot). The value for a slot
= minimum over cited products of the SHORTER end of each range, converted to days."""
import json, re
RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)),"foodkeeper_foodsafetygov_en_20260416.json")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),"shelf_life.json")
d = json.load(open(RAW))
P = {p["id"]: p for p in d["product_data"]}
AB = {"P": "pantry_output_display_only", "Pp": "from_date_of_purchase_pantry_output_display_only",
      "Po": "pantry_after_opening_output_display_only", "R": "refrigerate_output_display_only",
      "Rp": "from_date_of_purchase_refrigerate_output_display_only", "Ro": "refrigerate_after_opening_output_display_only",
      "Rt": "refrigerate_after_thawing_output_display_only", "F": "freeze_output_display_only",
      "Fp": "from_date_of_purchase_freeze_output_display_only", "Ptips": "pantry_tips"}
UNIT = {"day": 1, "days": 1, "week": 7, "weeks": 7, "month": 30, "months": 30, "year": 365, "years": 365}

def to_days(s):
    m = re.search(r"(\d+)\s*(?:-\s*\d+\s*)?(Days?|Weeks?|Months?|Years?)", s, re.I)
    if not m:
        return None
    return int(m.group(1)) * UNIT[m.group(2).lower()]

def label(pid):
    p = P[pid]; sub = (p.get("name_subtitle") or "").strip()
    return f'#{pid} "{p["name"].strip()}{" (" + sub + ")" if sub else ""}"'

FIELDNAME = {"P": "pantry", "Pp": "pantry from purchase", "Po": "pantry after opening", "R": "refrigerate",
             "Rp": "refrigerate from purchase", "Ro": "refrigerate after opening", "Rt": "refrigerate after thawing",
             "F": "freeze", "Fp": "freeze from purchase", "Ptips": "pantry tip"}

# slot: fridge|pantry|freezer ; cites: list of (id, abbrev)
CATS = [
 ("leafy greens", "fridge", {"fridge": [("415","R"),("291","Rp")]},
  {"freezer": "FoodKeeper lists freezing as 'Not Recommended' for #415 and #291.", "pantry": "No FoodKeeper pantry entry for leafy greens."}),
 ("berries", "fridge", {"fridge": [("481","Rp"),("482","Rp"),("253","Rp"),("254","Rp")], "freezer": [("481","F"),("482","F"),("254","F"),("253","F")]},
  {"pantry": "No FoodKeeper pantry entry for berries."}),
 ("other fresh fruit", "fridge", {"fridge": [("248","Rp"),("251","R"),("256","Rp"),("261","Rp"),("266","R"),("250","R")],
   "pantry": [("248","Pp"),("256","Pp"),("261","Pp")], "freezer": [("248","F"),("251","F"),("261","F"),("266","F")]},
  {"extra": "Bananas/avocados/stone fruit list pantry as 'When Ripe' (non-numeric) and are excluded from pantry_days. Citrus and avocado freezing is 'Not Recommended'. Category value is the most conservative cited product; apples/citrus actually last much longer (apples Rp 4-6 Weeks)."}),
 ("root vegetables", "fridge", {"fridge": [("279","Rp"),("274","Rp"),("297","Rp"),("294","Rp"),("307","Rp"),("299","Rp")],
   "pantry": [("297","Pp"),("294","Pp"),("422","Pp")], "freezer": [("279","Fp"),("274","Fp"),("297","F"),("294","Fp")]},
  {"extra": "pantry_days applies only to potatoes/onions/sweet potatoes; carrots, beets (Pp 1 Day) and radishes should be refrigerated. Radishes freezing 'Not Recommended'."}),
 ("other fresh vegetables", "fridge", {"fridge": [("276","Rp"),("280","Rp"),("296","Rp"),("283","Rp"),("302","Rp"),("292","Rp"),("271","Rp"),("281","Rp"),("600","R")],
   "freezer": [("276","Fp"),("296","Fp"),("271","Fp"),("292","Fp"),("302","Fp")]},
  {"pantry": "No single numeric pantry value: whole tomatoes are 'When Ripe' (#306); cherry tomatoes P=10 Days (#600); most others have no pantry entry. Left null.", "extra": "Cucumbers freezing 'Not Recommended' (#283)."}),
 ("fresh herbs", "fridge", {"fridge": [("288","Rp")], "freezer": [("288","Fp")]},
  {"pantry": "Generic 'Herbs' (#288) has no pantry entry (fresh basil #509 lists P=5 Days, but not generalized).", "extra": "Uses generic FoodKeeper 'Herbs' product. Item-level FoodKeeper values vary: parsley #611 R=2-3 Days, basil #509 R=10 Days, cilantro #506 R=2-3 Weeks."}),
 ("raw poultry", "fridge", {"fridge": [("113","Rp"),("116","Rp"),("117","Rp"),("118","Rp"),("114","Rp")], "freezer": [("113","Fp"),("116","Fp"),("117","Fp"),("118","Fp")]},
  {"pantry": "Not applicable (perishable raw meat)."}),
 ("raw ground meat", "fridge", {"fridge": [("43","Rp"),("73","Rp"),("115","Rp"),("50","Rp")], "freezer": [("43","Fp"),("73","Fp"),("115","Fp")]},
  {"pantry": "Not applicable (perishable raw meat)."}),
 ("raw whole cuts", "fridge", {"fridge": [("40","Rp"),("36","Rp"),("64","Rp"),("67","Rp"),("51","Rp")], "freezer": [("40","Fp"),("64","Fp"),("51","Fp")]},
  {"pantry": "Not applicable (perishable raw meat)."}),
 ("raw fish", "fridge", {"fridge": [("144","Rp"),("145","Rp"),("146","Rp")], "freezer": [("144","Fp"),("145","Fp"),("146","Fp")]},
  {"pantry": "Not applicable.", "extra": "Raw shellfish (shrimp etc., FoodKeeper Seafood/Shellfish) not covered by this category."}),
 ("deli meat", "fridge", {"fridge": [("184","Rp")], "freezer": [("184","F"),("192","Fp")]},
  {"pantry": "Not applicable.", "extra": "fridge_days uses store-sliced deli meat (#184). Pre-packaged unopened luncheon meat (#192) is Rp=2 Weeks, but only 3-5 Days after opening."}),
 ("eggs", "fridge", {"fridge": [("21","Rp")]},
  {"freezer": "FoodKeeper: freezing eggs in shell 'Not Recommended' (#21). (Raw whites/yolks out of shell #22 F=12 Months.)", "pantry": "No FoodKeeper pantry entry (US eggs must be refrigerated)."}),
 ("milk", "fridge", {"freezer": [("27","Fp")]},
  {"fridge": "FoodKeeper gives 'Package use-by date' for milk (#27), not a number. Left null: app should use printed date or ask user. (Lactose-free milk #543 Ro=1 Week after opening; ultra-pasteurized #659 R=1-3 Months unopened.)", "pantry": "Not applicable (refrigerated milk)."}),
 ("yogurt", "fridge", {"fridge": [("33","Rp")], "freezer": [("33","F")]}, {"pantry": "Not applicable."}),
 ("soft cheese", "fridge", {"fridge": [("7","Rp"),("10","Rp"),("9","Rp"),("490","Rp")], "freezer": [("7","Fp")]},
  {"pantry": "Not applicable.", "extra": "Includes brie/goat (#7), cream cheese (#10), cottage cheese (#9), ricotta (#490). Cream/cottage/ricotta freezing 'Not Recommended'; freezer value comes from #7 only."}),
 ("hard cheese", "fridge", {"fridge": [("3","Rp")], "freezer": [("3","Fp")]},
  {"pantry": "Not applicable.", "extra": "Unopened from purchase (#3 Rp=6 Months). After opening FoodKeeper says 3-4 Weeks (21 days). Shredded cheese (#5) Rp=1 Month."}),
 ("butter", "fridge", {"fridge": [("1","Rp")], "freezer": [("1","Fp")], "pantry": [("1","Ptips")]},
  {"extra": "pantry_days from FoodKeeper pantry_tips text for #1: 'May be left at room temperature for 1 - 2 days.'"}),
 ("bread", "pantry", {"pantry": [("195","Pp")], "fridge": [("195","Ro")], "freezer": [("195","Fp")]},
  {"extra": "Commercial bread products (#195). fridge_days uses FoodKeeper 'refrigerate after opening' (2-3 Weeks)."}),
 ("tortillas", "pantry", {"pantry": [("196","Pp"),("553","Pp")], "fridge": [("196","Ro"),("553","Rp")], "freezer": [("196","Fp")]},
  {"extra": "Corn tortillas (#553) have no freezer entry; freezer value is flour tortillas (#196) only."}),
 ("cooked leftovers", "fridge", {"fridge": [("173","R"),("174","R"),("141","Rp"),("185","Rp")], "freezer": [("173","F"),("174","F"),("141","Fp")]},
  {"pantry": "Not applicable (perishable).", "extra": "Also covers store-prepared hot foods such as rotisserie chicken (#141 Rp=3-4 Days) and deli main dishes (#185)."}),
 ("tofu", "fridge", {"fridge": [("168","Rp")], "freezer": [("168","Fp")]}, {"pantry": "Not applicable."}),
 ("opened condiments", "fridge", {"fridge": [("348","Ro"),("350","Ro"),("351","Ro"),("360","Ro"),("356","Ro"),("357","Ro")]},
  {"pantry": "Values here are refrigerate-after-opening. Unopened pantry life is long (e.g. ketchup #348 Pp=1 Year, mayo #350 Pp=3-6 Months) but this category represents opened items; left null.",
   "freezer": "No FoodKeeper freezer entry for these condiments.",
   "extra": "Excludes short-lived jarred sauces: pesto #354 Ro=3 Days, spaghetti sauce #359 Ro=4 Days - map those items explicitly if needed."}),
 ("canned goods", "pantry", {"pantry": [("372","Pp"),("373","Pp")], "fridge": [("372","Ro"),("373","Ro")]},
  {"freezer": "No FoodKeeper freezer entry for canned goods; pantry-after-opening 'Not Recommended'.", "extra": "fridge_days is AFTER OPENING (transfer contents to fridge)."}),
 ("dry goods/grains", "pantry", {"pantry": [("338","Pp"),("339","Pp"),("335","Pp"),("222","Pp"),("223","Pp"),("585","P"),("333","Pp"),("334","Pp")],
   "fridge": [("338","Ro"),("339","Ro"),("223","Ro")], "freezer": [("585","F"),("577","F"),("581","F")]},
  {"extra": "Most conservative cited product is whole wheat flour (#223 Pp=3-6 Months). White rice/dry pasta last 2 Years. fridge_days is FoodKeeper 'refrigerate after opening'."}),
 ("frozen foods", "freezer", {"freezer": [("331","Fp"),("330","Fp"),("315","Fp"),("321","Fp"),("317","Fp"),("313","Fp")], "fridge": [("331","R")]},
  {"pantry": "Not applicable.", "extra": "fridge_days applies to thawed frozen vegetables (#331 R=3-4 Days); frozen entrees/pancakes/potato products say refrigerating is 'Not Recommended'. Most conservative freezer value is pancakes/waffles (#321 Fp=3 Months)."}),
 ("beverages", "pantry", {"pantry": [("404","Pp")], "fridge": [("407","Ro"),("404","Ro")]},
  {"freezer": "No FoodKeeper freezer value used (not typical).", "extra": "Extra category (beyond the 25 requested) for shelf-stable drinks. pantry_days = juice cartons/fruit drinks (#404 Pp=3 Weeks); soda (#407) has no unopened value; bottled water (#413) 'Indefinitely'. fridge_days = after opening (soda #407 Ro=2-3 Days)."}),
 ("snacks", "pantry", {"pantry": [("392","Pp"),("377","Pp"),("394","Pp"),("374","Pp"),("658","P")]},
  {"fridge": "Not typical; left null.", "freezer": "Not typical; left null.", "extra": "Extra category for chips/crackers/pretzels/cereal/bars. Most conservative: potato chips #392 Pp=2 Months (1-2 Weeks after opening)."}),
]

out = []
for name, storage, cites, notes in CATS:
    rec = {"category": name}
    parts = []
    for slot in ("fridge", "pantry", "freezer"):
        cl = cites.get(slot)
        if not cl:
            rec[f"{slot}_days"] = None
            parts.append(f"{slot}_days null: {notes.get(slot, 'no FoodKeeper entry')}")
            continue
        vals = []
        for pid, ab in cl:
            raw = P[pid][AB[ab]]
            assert raw, (name, pid, ab)
            v = to_days(raw)
            assert v is not None, (name, pid, ab, raw)
            vals.append((v, pid, ab, raw))
        v = min(x[0] for x in vals)
        rec[f"{slot}_days"] = v
        srcs = "; ".join(f'{label(pid)} {FIELDNAME[ab]}="{raw.strip()}"->{dv}d' for dv, pid, ab, raw in vals)
        parts.append(f"{slot}_days={v} (min of shorter range ends): {srcs}")
        if slot in notes:
            parts.append(notes[slot])
    rec["default_storage"] = storage
    if "extra" in notes:
        parts.append(notes["extra"])
    rec["foodkeeper_product_ids"] = sorted({pid for cl in cites.values() for pid, _ in cl}, key=int)
    rec["source_note"] = "USDA FoodKeeper (foodsafety.gov JSON). Conversion: 1 week=7d, 1 month=30d, 1 year=365d. " + " | ".join(parts)
    out.append(rec)

doc = {"source": {"name": "USDA FSIS FoodKeeper data (English JSON)",
                  "url": "https://www.foodsafety.gov/sites/default/files/foodkeeper_data_url_en.json",
                  "retrieved_via": "https://web.archive.org/web/20260416174248id_/https://www.foodsafety.gov/sites/default/files/foodkeeper_data_url_en.json (direct fsis.usda.gov/foodsafety.gov downloads returned HTTP 403 from our network)",
                  "catalog": "https://catalog.data.gov/dataset/fsis-foodkeeper-data",
                  "license": "CC0 1.0 (per data.gov)",
                  "method": "For each category, cited FoodKeeper products; each range reduced to its shorter end; category value = minimum across cited products. Weeks x7, months x30, years x365. Non-numeric values ('When Ripe', 'Package use-by date', 'Not Recommended', 'Indefinitely') are never converted; they yield null."},
       "categories": out}
json.dump(doc, open(OUT, "w"), indent=2)
for r in out:
    print(f'{r["category"]:24} F={r["fridge_days"]} P={r["pantry_days"]} Z={r["freezer_days"]} {r["default_storage"]}')
