"""Build nutrition.csv from hand-curated scripts/items.txt + FDC bulk CSVs.
Run from a working dir containing ff/ (Foundation CSV) and sr/ (SR Legacy CSV), see download.sh:
  python3 flatten_fdc.py && python3 build_nutrition.py
Reads items.txt next to this script; writes nutrition.csv + nutrition.json to the cwd.
"""
import csv, difflib, os, sys, pandas as pd

CATEGORIES = {"leafy_greens","berries","fresh_fruit","fresh_vegetables","root_vegetables","herbs",
  "raw_poultry","raw_meat","raw_seafood","deli_meat","dairy_milk","dairy_cheese","yogurt","eggs",
  "tofu","bread","tortillas","cooked_leftovers","frozen","canned","dry_goods","condiments","snacks",
  "beverages","other"}  # = supabase/migrations/0001_init.sql shelf_life rows / server CATEGORIES

t = pd.read_csv('fdc_flat.csv')
def norm(d):
    return ' '.join(str(d).replace('\xa0', ' ').split()).lower()
t['n_nuts'] = t[['kcal','kcal_atw_gen','kcal_atw_spec','protein','carbs','fat','fiber']].notna().sum(axis=1)
idx = {}
for r in t.sort_values('n_nuts').itertuples():   # on case-insensitive duplicate descriptions keep the record with most data
    idx[(r.data_type, norm(r.description))] = r
desc_by_type = {k: t[t.data_type == k].description.tolist() for k in ('foundation', 'sr_legacy')}

# Fiber (1079) is often not analysed in newer Foundation records. For plant foods we borrow fiber from the
# closest SR Legacy record (hand-picked); for foods with no plant material fiber is set to 0.
FIBER_FALLBACK = {
 'red grapes':'Grapes, red or green (European type, such as Thompson seedless), raw',
 'green grapes':'Grapes, red or green (European type, such as Thompson seedless), raw',
 'strawberries':'Strawberries, raw','blueberries':'Blueberries, raw','raspberries':'Raspberries, raw',
 'avocado':'Avocados, raw, California','honeydew':'Melons, honeydew, raw','cherries':'Cherries, sweet, raw',
 'romaine':'Lettuce, cos or romaine, raw','iceberg lettuce':'Lettuce, iceberg (includes crisphead types), raw',
 'green leaf lettuce':'Lettuce, green leaf, raw','red leaf lettuce':'Lettuce, red leaf, raw',
 'celery':'Celery, raw','cucumber':'Cucumber, with peel, raw','cabbage':'Cabbage, raw','red cabbage':'Cabbage, red, raw',
 'russet potatoes':"Potatoes, russet, flesh and skin, raw (Includes foods for USDA's Food Distribution Program)",
 'red potatoes':'Potatoes, red, flesh and skin, raw','yukon gold potatoes':'Potatoes, white, flesh and skin, raw',
 'sweet potato':"Sweet potato, raw, unprepared (Includes foods for USDA's Food Distribution Program)",
 'black beans':'Beans, black, mature seeds, canned, low sodium',
 'kidney beans':'Beans, kidney, red, mature seeds, canned, drained solids',
 'pinto beans':'Beans, pinto, canned, drained solids',
 'chickpeas':'Chickpeas (garbanzo beans, bengal gram), mature seeds, canned, drained, rinsed in tap water',
 'cannellini beans':'Beans, great northern, mature seeds, canned','great northern beans':'Beans, great northern, mature seeds, canned',
 'navy beans':'Beans, navy, mature seeds, canned',
 'black-eyed peas':'Cowpeas, common (blackeyes, crowder, southern), mature seeds, canned, plain',
 'canned green beans':'Beans, snap, green, canned, regular pack, drained solids',
 'canned peas':'Peas, green, canned, no salt added, drained solids',
 'diced tomatoes':'Tomatoes, red, ripe, canned, packed in tomato juice',
 'applesauce':'Applesauce, canned, unsweetened, with added ascorbic acid',
 'rolled oats':'Cereals, oats, regular and quick, not fortified, dry','steel cut oats':'Cereals, oats, regular and quick, not fortified, dry',
 'dry lentils':'Lentils, raw','dry chickpeas':'Chickpeas (garbanzo beans, bengal gram), mature seeds, raw',
 'all-purpose flour':'Wheat flour, white, all-purpose, enriched, bleached','bread flour':'Wheat flour, white, bread, enriched',
 'chia seeds':'Seeds, chia seeds, dried','ketchup':'Catsup',
 'orange juice':'Orange juice, chilled, includes from concentrate',
 'apple juice':'Apple juice, canned or bottled, unsweetened, with added ascorbic acid',
 'cranberry juice':'Cranberry juice, unsweetened',
 'grape juice':'Grape juice, canned or bottled, unsweetened, with added ascorbic acid',
 'tomato juice':'Tomato juice, canned, with salt added',
 'almond milk':'Beverages, almond milk, unsweetened, shelf stable',
 'soy milk':'Soymilk, original and vanilla, with added calcium, vitamins A and D',
 # SR Legacy records that themselves lack fiber -> nearest SR record that has it
 'coconut milk':'Nuts, coconut milk, raw (liquid expressed from grated meat and water)',
 'trail mix':'Snacks, trail mix, regular, with chocolate chips, salted nuts and seeds',
 'balsamic vinegar':'Vinegar, red wine',
 # tempeh: no tempeh record in SR Legacy or Foundation carries fiber -> left blank
}
PLANT_MILKS = {'almond milk','oat milk','soy milk','coffee creamer'}
ZERO_FIBER_CATS = {'raw_poultry','raw_meat','raw_seafood','deli_meat','dairy_milk','dairy_cheese','yogurt','eggs'}
ZERO_FIBER_ITEMS = {'sugar','coconut oil','salt','canned tuna','anchovies','turkey sausage','hot dogs','deli ham'}
ZERO_MACRO_ITEMS = {'salt'}  # salt has no protein/carb/fat

def r1(x):
    return '' if pd.isna(x) else round(float(x), 1)

rows, errors, notes = [], [], []
seen = set()
for ln in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'items.txt')):
    ln = ln.rstrip('\n')
    if not ln.strip() or ln.startswith('#'):
        continue
    parts = [p.strip() for p in ln.split(' ; ')]
    if len(parts) != 6:
        errors.append(f'BAD LINE: {ln}'); continue
    name, aliases, src, cat, pkg_g, pkg_desc = parts
    if name in seen: errors.append(f'DUP {name}')
    seen.add(name)
    if cat not in CATEGORIES: errors.append(f'BAD CATEGORY {cat} for {name}')
    kind = {'F': 'foundation', 'S': 'sr_legacy'}[src[0]]
    desc = src[2:].strip()
    r = idx.get((kind, norm(desc)))
    if r is None:
        sug = difflib.get_close_matches(desc, desc_by_type[kind], n=4, cutoff=0.4)
        errors.append(f'MISS {name} [{kind}] "{desc}" -> {sug}'); continue
    kcal, ksrc = r.kcal, '1008'
    if pd.isna(kcal):
        if not pd.isna(r.kcal_atw_spec): kcal, ksrc = r.kcal_atw_spec, '2048'
        elif not pd.isna(r.kcal_atw_gen): kcal, ksrc = r.kcal_atw_gen, '2047'
        else: ksrc = ''
    row = dict(item_name=name, aliases=aliases, fdc_id=r.fdc_id, fdc_description=r.description.strip(),
               data_type=kind, category=cat, calories_kcal_100g=r1(kcal), protein_g_100g=r1(r.protein),
               carbs_g_100g=r1(r.carbs), fat_g_100g=r1(r.fat), fiber_g_100g=r1(r.fiber),
               typical_package_size_g=int(pkg_g), typical_package_desc=pkg_desc, energy_source_nutrient=ksrc,
               fiber_source='fdc' if not pd.isna(r.fiber) else '')
    # Foundation 'carbohydrate by difference' can be slightly negative for meats (analytical noise); clamp to 0
    if row['carbs_g_100g'] != '' and row['carbs_g_100g'] < 0:
        notes.append(f'CLAMP {name}: carbs {row["carbs_g_100g"]} -> 0.0'); row['carbs_g_100g'] = 0.0
    if name in ZERO_MACRO_ITEMS:
        for k in ('protein_g_100g','carbs_g_100g','fat_g_100g'):
            if row[k] == '': row[k] = 0.0
    if row['fiber_g_100g'] == '':
        if name in FIBER_FALLBACK:
            fr = idx.get(('sr_legacy', norm(FIBER_FALLBACK[name])))
            if fr is None or pd.isna(fr.fiber): errors.append(f'BAD FIBER FALLBACK {name}')
            else: row['fiber_g_100g'] = r1(fr.fiber); row['fiber_source'] = f'sr_legacy:{fr.fdc_id}'
        elif (cat in ZERO_FIBER_CATS and name not in PLANT_MILKS) or name in ZERO_FIBER_ITEMS:
            row['fiber_g_100g'] = 0.0; row['fiber_source'] = 'assumed_zero'
    blanks = [k for k in ('calories_kcal_100g','protein_g_100g','carbs_g_100g','fat_g_100g','fiber_g_100g') if row[k] == '']
    if blanks: notes.append(f'{name} ({kind} {r.fdc_id}): blank {blanks}')
    # sanity checks
    if row['calories_kcal_100g'] != '':
        k = row['calories_kcal_100g']; p, c, f = [row[x] or 0 for x in ('protein_g_100g','carbs_g_100g','fat_g_100g')]
        est = 4*p + 4*c + 9*f
        if k > 902 or (est > 20 and abs(est - k) / max(k, 1) > 0.25):
            notes.append(f'CHECK {name}: kcal {k} vs 4/4/9 estimate {est:.0f}')
    if p + c + f > 101: notes.append(f'CHECK {name}: macros sum >100 g')
    if 'cooked' in row['fdc_description'].lower() and cat != 'cooked_leftovers' and 'uncooked' not in row['fdc_description'].lower():
        notes.append(f'NOTE {name}: description mentions cooked -> {row["fdc_description"]}')
    rows.append(row)

for e in errors: print(e)
for n in notes: print(n)
if errors:
    sys.exit(f'{len(errors)} errors')
with open('nutrition.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
import json
def num(v): return None if v == '' else v
js = [dict(item_name=r['item_name'], aliases=[a for a in r['aliases'].split('|') if a], fdc_id=int(r['fdc_id']),
           fdc_description=r['fdc_description'], data_type=r['data_type'], category=r['category'],
           calories_kcal_100g=num(r['calories_kcal_100g']), protein_g_100g=num(r['protein_g_100g']),
           carbs_g_100g=num(r['carbs_g_100g']), fat_g_100g=num(r['fat_g_100g']), fiber_g_100g=num(r['fiber_g_100g']),
           typical_package_size_g=r['typical_package_size_g'], typical_package_desc=r['typical_package_desc'],
           energy_source_nutrient=r['energy_source_nutrient'] or None, fiber_source=r['fiber_source'] or None) for r in rows]
with open('nutrition.json', 'w') as fh:
    json.dump(js, fh, indent=1, ensure_ascii=False); fh.write('\n')
print(len(rows), 'rows ->nutrition.csv + nutrition.json', pd.Series([r['data_type'] for r in rows]).value_counts().to_dict())
