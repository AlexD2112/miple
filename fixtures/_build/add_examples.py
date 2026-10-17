import os
import json
F=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),"shelf_life.json")
doc=json.load(open(F))
E={
"leafy greens":["baby spinach","romaine lettuce","iceberg lettuce","spring mix","arugula","kale","butter lettuce","swiss chard","bagged caesar salad kit"],
"berries":["strawberries","blueberries","raspberries","blackberries","cherries"],
"other fresh fruit":["bananas","gala apples","honeycrisp apples","lemons","limes","navel oranges","mandarins","red grapes","avocados","peaches","bartlett pears","mango","pineapple","kiwi"],
"root vegetables":["russet potatoes","yukon gold potatoes","sweet potatoes","yellow onions","red onions","carrots","baby carrots","beets","radishes","parsnips"],
"other fresh vegetables":["broccoli crowns","cauliflower","red bell pepper","english cucumber","zucchini","cremini mushrooms","asparagus","celery","cherry tomatoes","roma tomatoes","green beans","brussels sprouts","jalapeno"],
"fresh herbs":["cilantro","italian parsley","fresh basil","green onions bunch","fresh mint","fresh dill"],
"raw poultry":["boneless skinless chicken breast","chicken thighs","whole chicken","chicken drumsticks","turkey breast"],
"raw ground meat":["ground beef 80/20","ground turkey","ground pork","italian sausage bulk","ground chicken"],
"raw whole cuts":["ribeye steak","pork chops","pork tenderloin","chuck roast","lamb chops"],
"raw fish":["atlantic salmon fillet","cod fillet","halibut","tilapia fillets","ahi tuna steak"],
"deli meat":["sliced turkey breast","black forest ham","genoa salami","sliced roast beef"],
"eggs":["large brown eggs","cage free eggs 18ct","pasture raised eggs"],
"milk":["2% milk gallon","whole milk half gallon","oat milk","almond milk","half and half"],
"yogurt":["greek yogurt plain","vanilla yogurt cups","kefir"],
"soft cheese":["brie","goat cheese","cream cheese","cottage cheese","ricotta","fresh mozzarella"],
"hard cheese":["sharp cheddar block","parmigiano reggiano","swiss cheese","tillamook medium cheddar"],
"butter":["unsalted butter","salted butter","kerrygold butter"],
"bread":["sourdough loaf","whole wheat sandwich bread","hamburger buns","bagels","dave's killer bread"],
"tortillas":["flour tortillas","corn tortillas"],
"cooked leftovers":["rotisserie chicken","deli fried chicken","prepared mac and cheese"],
"tofu":["extra firm tofu","silken tofu"],
"opened condiments":["ketchup","mayonnaise","dijon mustard","soy sauce","sriracha","ranch dressing","salsa jar","peanut butter"],
"canned goods":["black beans can","diced tomatoes can","chicken broth carton","coconut milk can","tuna can"],
"dry goods/grains":["jasmine rice","spaghetti","penne","rolled oats","all purpose flour","quinoa","dried lentils"],
"frozen foods":["frozen peas","frozen broccoli","frozen pizza","frozen mixed berries","ice cream","frozen waffles","frozen dumplings"],
"beverages":["orange juice","sparkling water","cola 12pk","ground coffee"],
"snacks":["tortilla chips","potato chips","crackers","granola bars","cereal"],
}
cats={c["category"] for c in doc["categories"]}
assert set(E)<=cats
doc["examples"]=[{"item":i,"category":c} for c,items in E.items() for i in items]
doc["examples_note"]="Item->category mapping is our editorial judgment (not from FoodKeeper). Items like peanut butter (FoodKeeper #387 opened 2-3 Months) are approximated by their category."
json.dump(doc,open(F,"w"),indent=2)
print(len(doc["examples"]))

# Map to the app's existing enum (server/src/domain/schemas.ts CATEGORIES on main @ 4db1960)
APP={"leafy greens":"leafy_greens","berries":"berries","other fresh fruit":"fresh_fruit","root vegetables":"root_vegetables",
 "other fresh vegetables":"fresh_vegetables","fresh herbs":"herbs","raw poultry":"raw_poultry","raw ground meat":"raw_meat",
 "raw whole cuts":"raw_meat","raw fish":"raw_seafood","deli meat":"deli_meat","eggs":"eggs","milk":"dairy_milk","yogurt":"yogurt",
 "soft cheese":"dairy_cheese","hard cheese":"dairy_cheese","butter":"other","bread":"bread","tortillas":"tortillas",
 "cooked leftovers":"cooked_leftovers","tofu":"tofu","opened condiments":"condiments","canned goods":"canned",
 "dry goods/grains":"dry_goods","frozen foods":"frozen","beverages":"beverages","snacks":"snacks"}
for c in doc["categories"]:
    c["app_category_key"]=APP[c["category"]]
doc["app_category_key_note"]="app_category_key maps to CATEGORIES in server/src/domain/schemas.ts (main @ 4db1960). Lossy: raw ground meat + raw whole cuts -> raw_meat (1 vs 3 fridge days), soft + hard cheese -> dairy_cheese (7 vs 180), butter has no app key (-> other). receipt_lines extra categories non_food/discount/deposit/fee have no app key (use 'other' or drop before pantry insert)."
json.dump(doc,open(F,"w"),indent=2)
