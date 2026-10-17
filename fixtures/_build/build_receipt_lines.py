import os
import json
OUT=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),"receipt_lines.json")
# store|raw_text|normalized_name|quantity|unit|price|category   (price = extended line amount, USD; negative for discounts)
RAW = r"""
Safeway|ORG SPNCH 5OZ|organic baby spinach 5 oz|1|ea|4.99|leafy greens
Safeway|O ORGANICS SPRING MIX|o organics spring mix|1|ea|5.49|leafy greens
Safeway|BANANAS|bananas|2.41|lb|1.66|other fresh fruit
Safeway|2.41 lb @ 0.69 /lb|bananas (weight detail line)|2.41|lb|1.66|other fresh fruit
Safeway|SIG SLCT BRD WHT|signature select white bread|1|ea|3.49|bread
Safeway|LUCERNE MLK 2% GAL|lucerne 2% milk gallon|1|gal|4.29|milk
Safeway|LUCERNE LG EGGS 12CT|lucerne large eggs 12 ct|1|dozen|3.99|eggs
Safeway|2 @ 2 FOR 5.00 BARILLA PENNE|barilla penne|2|ea|5.00|dry goods/grains
Safeway|CLUB CARD SAVINGS|club card savings|1|ea|-1.98|discount
Safeway|FSTR FRMS BNLS BRST|foster farms boneless skinless chicken breast|1.87|lb|9.33|raw poultry
Safeway|1.87 lb @ 4.99 /lb|chicken breast (weight detail line)|1.87|lb|9.33|raw poultry
Safeway|SW GRND BF 80/20|ground beef 80/20|1|ea|7.99|raw ground meat
Safeway|AVOCADOS HASS LG|hass avocado large|3|ea|5.97|other fresh fruit
Safeway|3 @ 1.99|avocado (qty detail line)|3|ea|5.97|other fresh fruit
Safeway|J4U DIGITAL CPN|just for u digital coupon|1|ea|-1.00|discount
Safeway|CABOT SHRP CHDR 8OZ|cabot sharp cheddar 8 oz|1|ea|4.49|hard cheese
Safeway|TILLAMOOK YGRT VAN|tillamook vanilla yogurt|1|ea|1.25|yogurt
Safeway|SIG KTCHNS TORT FLR 10CT|signature kitchens flour tortillas 10 ct|1|ea|2.99|tortillas
Safeway|CELERY HEARTS|celery hearts|1|ea|3.49|other fresh vegetables
Safeway|CILANTRO|cilantro bunch|1|ea|0.99|fresh herbs
Safeway|SW DELI TRKY BRST SLCD|deli sliced turkey breast|0.62|lb|7.44|deli meat
Safeway|KLEENEX 3PK|kleenex tissues 3 pk|1|ea|6.99|non_food
Safeway|CA CRV|california redemption value (CA store)|6|ea|0.30|deposit
Safeway|PEPSI 12PK 12OZ CAN|pepsi 12 pack cans|1|ea|7.99|beverages
Safeway|BAG FEE PAPER|paper bag charge|2|ea|0.16|fee
QFC|KRO ORG BABY SPINACH|kroger organic baby spinach|1|ea|3.99|leafy greens
QFC|SIMPLE TRTH ORG CARROTS 2LB|simple truth organic carrots 2 lb|1|ea|2.79|root vegetables
QFC|STRAWBERRIES 1LB|strawberries 1 lb|1|ea|3.99|berries
QFC|SC STRAWBERRIES|store coupon strawberries|1|ea|-1.00|discount
QFC|KRO 2PCT MLK HG|kroger 2% milk half gallon|1|ea|2.69|milk
QFC|DARIGOLD BUTTER UNSLTD|darigold unsalted butter|1|ea|5.49|butter
QFC|KRO SHRD MOZZ 8OZ|kroger shredded mozzarella 8 oz|1|ea|2.50|hard cheese
QFC|PRIV SEL SOURDOUGH|private selection sourdough loaf|1|ea|4.99|bread
QFC|YELLOW ONIONS|yellow onions|1.32|lb|1.31|root vegetables
QFC|1.32 lb @ 0.99 /lb|yellow onions (weight detail line)|1.32|lb|1.31|root vegetables
QFC|RUSSET POTATOES 5LB|russet potatoes 5 lb bag|1|ea|4.49|root vegetables
QFC|ATL SALMON FLLT|atlantic salmon fillet|1.12|lb|13.43|raw fish
QFC|1.12 lb @ 11.99 /lb|salmon (weight detail line)|1.12|lb|13.43|raw fish
QFC|HOUSE FOODS TOFU XFRM|house foods extra firm tofu|1|ea|2.29|tofu
QFC|KRO SAVINGS|kroger card savings|1|ea|-0.80|discount
QFC|KRO BLK BEANS 15OZ|kroger black beans 15 oz can|3|ea|2.67|canned goods
QFC|3 @ 0.89|black beans (qty detail line)|3|ea|2.67|canned goods
QFC|BUY 5 SAVE 5 DIGITAL|mega event digital discount|1|ea|-5.00|discount
QFC|KRO FZN PEAS 12OZ|kroger frozen peas 12 oz|1|ea|1.50|frozen foods
QFC|TILLAMOOK ICE CRM 48OZ|tillamook ice cream 48 oz|1|ea|5.99|frozen foods
QFC|ORG ITAL PARSLEY|organic italian parsley|1|ea|1.99|fresh herbs
QFC|HEINZ KETCHUP 32OZ|heinz ketchup 32 oz|1|ea|4.29|opened condiments
QFC|BOUNTY SAS 6=15|bounty select-a-size paper towels|1|ea|11.99|non_food
QFC|PAPER BAG|paper bag charge|1|ea|0.08|fee
Fred Meyer|FM RED BELL PEPPER|red bell pepper|2|ea|2.50|other fresh vegetables
Fred Meyer|2 @ 1.25|red bell pepper (qty detail line)|2|ea|2.50|other fresh vegetables
Fred Meyer|BROCCOLI CROWNS|broccoli crowns|1.47|lb|2.92|other fresh vegetables
Fred Meyer|1.47 lb @ 1.99 /lb|broccoli (weight detail line)|1.47|lb|2.92|other fresh vegetables
Fred Meyer|GALA APPLES|gala apples|2.86|lb|5.69|other fresh fruit
Fred Meyer|ORG HNYCRSP APL|organic honeycrisp apples|1.05|lb|3.15|other fresh fruit
Fred Meyer|LEMONS EA|lemon|4|ea|2.76|other fresh fruit
Fred Meyer|KRO LG EGGS 18CT|kroger large eggs 18 ct|1|ea|4.99|eggs
Fred Meyer|SMPL TRTH ORG OAT MLK|simple truth organic oat milk|1|ea|3.79|milk
Fred Meyer|CHOBANI GRK YGRT PLN 32|chobani plain greek yogurt 32 oz|1|ea|5.99|yogurt
Fred Meyer|KRO CRM CHS 8OZ|kroger cream cheese 8 oz|1|ea|1.99|soft cheese
Fred Meyer|DAVES KLR BRD 21 GRN|dave's killer bread 21 whole grains|1|ea|6.49|bread
Fred Meyer|CPN DAVES KLR BRD|dave's killer bread coupon|1|ea|-1.50|discount
Fred Meyer|PORK LOIN CHOPS BNLS|boneless pork loin chops|2.04|lb|8.14|raw whole cuts
Fred Meyer|2.04 lb @ 3.99 /lb|pork chops (weight detail line)|2.04|lb|8.14|raw whole cuts
Fred Meyer|JENNIE O GRND TRKY 1LB|jennie-o ground turkey 1 lb|1|ea|5.49|raw ground meat
Fred Meyer|KRO JASMINE RICE 5LB|kroger jasmine rice 5 lb|1|ea|6.99|dry goods/grains
Fred Meyer|ROLLED OATS 42OZ|old fashioned rolled oats 42 oz|1|ea|4.99|dry goods/grains
Fred Meyer|HUY FONG SRIRACHA|huy fong sriracha|1|ea|5.49|opened condiments
Fred Meyer|KRO DICED TOM 14.5Z|kroger diced tomatoes 14.5 oz|2|ea|2.00|canned goods
Fred Meyer|TIDE PODS 42CT|tide pods 42 ct|1|ea|13.99|non_food
Fred Meyer|FM AA BATTERIES 8PK|aa batteries 8 pk|1|ea|7.99|non_food
Fred Meyer|OR BTL DEP|oregon bottle deposit (OR store)|6|ea|0.60|deposit
Fred Meyer|LACROIX LIME 8PK|lacroix lime sparkling water 8 pk|1|ea|4.99|beverages
Fred Meyer|FUEL PTS 2X|fuel points promotion (non-monetary)|1|ea|0.00|discount
Trader Joe's|ORGANIC BABY SPINACH|tj's organic baby spinach|1|ea|2.49|leafy greens
Trader Joe's|BANANA EACH|banana|6|ea|1.38|other fresh fruit
Trader Joe's|6 @ 0.23|banana (qty detail line)|6|ea|1.38|other fresh fruit
Trader Joe's|BLUEBERRIES 18 OZ|blueberries 18 oz|1|ea|4.99|berries
Trader Joe's|AVOCADOS BAG 4CT|avocados bag 4 ct|1|ea|3.99|other fresh fruit
Trader Joe's|TJ'S MANDARIN ORANGE CHKN|tj's mandarin orange chicken (frozen)|1|ea|5.49|frozen foods
Trader Joe's|TJ'S GYOZA CHICKEN|tj's chicken gyoza potstickers (frozen)|1|ea|3.99|frozen foods
Trader Joe's|CAULIFLOWER GNOCCHI|tj's cauliflower gnocchi (frozen)|1|ea|2.99|frozen foods
Trader Joe's|TJ'S EVERYTHING BAGEL SEAS|tj's everything but the bagel seasoning|1|ea|2.49|dry goods/grains
Trader Joe's|R-MILK 2% REDUCED FAT GAL|reduced fat 2% milk gallon|1|ea|3.79|milk
Trader Joe's|EGGS LARGE BROWN CAGE FREE|large brown cage free eggs|1|dozen|3.49|eggs
Trader Joe's|GREEK NONFAT YOGURT PLAIN|tj's plain nonfat greek yogurt|1|ea|4.49|yogurt
Trader Joe's|UNEXPECTED CHEDDAR|tj's unexpected cheddar|0.58|lb|4.63|hard cheese
Trader Joe's|BRIE DOUBLE CREME|tj's double creme brie|1|ea|5.99|soft cheese
Trader Joe's|SOURDOUGH SLICED PAN|tj's sliced sourdough pan loaf|1|ea|3.49|bread
Trader Joe's|CORN TORTILLAS HANDMADE STYLE|tj's handmade style corn tortillas|1|ea|2.29|tortillas
Trader Joe's|CHICKEN BREAST BNLS SKNLS|boneless skinless chicken breast|1.43|lb|5.71|raw poultry
Trader Joe's|ITALIAN PARSLEY|italian parsley|1|ea|1.49|fresh herbs
Trader Joe's|TOFU ORGANIC SPROUTED|tj's organic sprouted tofu|1|ea|2.29|tofu
Trader Joe's|TJ'S SPAGHETTI|tj's spaghetti|2|ea|2.58|dry goods/grains
Trader Joe's|2 @ 1.29|spaghetti (qty detail line)|2|ea|2.58|dry goods/grains
Trader Joe's|ORGANIC TOMATO BASIL MARINARA|tj's organic tomato basil marinara|1|ea|2.99|canned goods
Trader Joe's|DARK CHOC PB CUPS|tj's dark chocolate peanut butter cups|1|ea|4.49|snacks
Trader Joe's|FLOWERS SUNFLOWER BUNCH|sunflowers bouquet|1|ea|4.99|non_food
Trader Joe's|BAG CHARGE|paper bag charge|1|ea|0.08|fee
Trader Joe's|CA REDEMP VAL|california redemption value (CA store)|4|ea|0.20|deposit
Costco|** KS TOWELS **|kirkland signature paper towels|1|ea|18.79|non_food
Costco|KS Chic tort|kirkland signature chicken tortellini (uncertain; per thread)|1|ea||cooked leftovers
Costco|KS dbl roll|kirkland signature double roll (wrapping paper per thread; uncertain)|1|ea||non_food
Costco|1170000 KS ROTIS CHKN|kirkland signature rotisserie chicken|1|ea|4.99|cooked leftovers
Costco|1092000 KS ORG EGGS 24CT|kirkland signature organic eggs 24 ct|1|ea|8.49|eggs
Costco|1201000 ORG SPRING MIX 1LB|organic spring mix 1 lb|1|ea|4.99|leafy greens
Costco|1110000 STRAWBERRIES 2LB|strawberries 2 lb|1|ea|5.99|berries
Costco|1110001 BLUEBERRY 18OZ|blueberries 18 oz|2|ea|11.98|berries
Costco|2 @ 5.99|blueberries (qty detail line)|2|ea|11.98|berries
Costco|1131000 KS 2% MILK 2/1GAL|kirkland signature 2% milk 2 x 1 gal|1|ea|6.49|milk
Costco|1122000 KS BUTTER UNSALTD 4LB|kirkland signature unsalted butter 4 x 1 lb|1|ea|12.99|butter
Costco|1123000 KS GRK YOGURT 48OZ|kirkland signature greek yogurt 48 oz|1|ea|6.99|yogurt
Costco|1124000 TILLAMOOK MED CHED 2.5LB|tillamook medium cheddar 2.5 lb|1|ea|10.99|hard cheese
Costco|1150000 KS GRND BEEF 88/12|kirkland ground beef 88/12|4.12|lb|20.56|raw ground meat
Costco|1150001 KS BNLS SKNLS CHKN BRST|kirkland boneless skinless chicken breast|6.20|lb|23.81|raw poultry
Costco|1150002 ATL SALMON FILLET|atlantic salmon fillet|3.05|lb|30.47|raw fish
Costco|0000355 TPD/BLUEBERRY|instant savings blueberries|1|ea|-2.00|discount
Costco|1160000 KS JASMINE RICE 25LB|kirkland jasmine rice 25 lb|1|ea|19.99|dry goods/grains
Costco|1161000 KS ORG BLK BEANS 8PK|kirkland organic black beans 8 cans|1|ea|10.49|canned goods
Costco|1170001 KS CROISSANT 12CT|kirkland croissants 12 ct|1|ea|6.99|bread
Costco|1180000 MISSION FLR TORT 40CT|mission flour tortillas 40 ct|1|ea|6.99|tortillas
Costco|1190000 KS FRZN BERRIES 4LB|kirkland frozen three berry blend 4 lb|1|ea|12.99|frozen foods
Costco|1190001 BIBIGO MANDU 6LB|bibigo pork mandu dumplings 6 lb|1|ea|15.99|frozen foods
Costco|1191000 KS WATER 40PK|kirkland bottled water 40 pk|1|ea|4.99|beverages
Costco|1191001 KS BATH TISSUE 30RL|kirkland bath tissue 30 rolls|1|ea|23.99|non_food
Costco|0000356 TPD/KS BATH|instant savings bath tissue|1|ea|-4.00|discount
Whole Foods|365 ORG BABY SPINACH 5OZ|365 by whole foods organic baby spinach 5 oz|1|ea|3.29|leafy greens
Whole Foods|ORG ROMAINE HEARTS 3CT|organic romaine hearts 3 ct|1|ea|3.99|leafy greens
Whole Foods|ORG RASPBERRIES 6OZ|organic raspberries 6 oz|1|ea|4.99|berries
Whole Foods|PRIME MEMBER DEAL|prime member savings|1|ea|-1.50|discount
Whole Foods|ORG LEMONS|organic lemons|3|ea|2.97|other fresh fruit
Whole Foods|ORG GALA APPLE|organic gala apples|1.65|lb|4.11|other fresh fruit
Whole Foods|1.65 lb @ 2.49 /lb|apples (weight detail line)|1.65|lb|4.11|other fresh fruit
Whole Foods|ORG CARROTS BUNCH|organic carrots bunch|1|ea|2.49|root vegetables
Whole Foods|SWEET POTATOES|sweet potatoes|2.30|lb|4.58|root vegetables
Whole Foods|ORG GRAPE TOMATOES PINT|organic grape tomatoes pint|1|ea|3.99|other fresh vegetables
Whole Foods|ORG BASIL 0.75OZ|organic basil clamshell|1|ea|2.99|fresh herbs
Whole Foods|365 WHL MILK HG|365 whole milk half gallon|1|ea|3.49|milk
Whole Foods|STRAUS GRK YOG PLN|straus plain greek yogurt|1|ea|6.99|yogurt
Whole Foods|PARMIGIANO REGGIANO|parmigiano reggiano wedge|0.45|lb|10.35|hard cheese
Whole Foods|365 GOAT CHEESE PLN|365 plain goat cheese|1|ea|3.99|soft cheese
Whole Foods|WF GRND BF 85/15 GRSFD|grass-fed ground beef 85/15|1|ea|8.99|raw ground meat
Whole Foods|RIBEYE STEAK BNLS|boneless ribeye steak|0.89|lb|17.79|raw whole cuts
Whole Foods|0.89 lb @ 19.99 /lb|ribeye (weight detail line)|0.89|lb|17.79|raw whole cuts
Whole Foods|WILD COD FILLET|wild cod fillet|0.74|lb|9.62|raw fish
Whole Foods|365 SLICED TURKEY BRST|365 sliced turkey breast|1|ea|5.99|deli meat
Whole Foods|365 ORG EXT FIRM TOFU|365 organic extra firm tofu|1|ea|2.49|tofu
Whole Foods|365 ORG DIJON MUSTARD|365 organic dijon mustard|1|ea|2.79|opened condiments
Whole Foods|HOT BAR|hot bar prepared food by weight|1.06|lb|12.71|cooked leftovers
Whole Foods|365 ORG QUINOA|365 organic quinoa|1|ea|4.99|dry goods/grains
Whole Foods|SEVENTH GEN DISH SOAP|seventh generation dish soap|1|ea|4.49|non_food
Whole Foods|BAG REFUND|reusable bag credit|1|ea|-0.10|discount
Target|GG BABY SPINACH 5OZ|good & gather baby spinach 5 oz|1|ea|2.99|leafy greens
Target|GG ORG STRAWBERRIES 1LB|good & gather organic strawberries 1 lb|1|ea|4.49|berries
Target|BANANAS|bananas|3|ea|0.75|other fresh fruit
Target|GG 2% MILK GAL|good & gather 2% milk gallon|1|ea|3.69|milk
Target|GG LG GRADE A EGGS 12CT|good & gather large eggs 12 ct|1|ea|2.99|eggs
Target|GG SHRD CHEDDAR 8OZ|good & gather shredded cheddar 8 oz|1|ea|2.39|hard cheese
Target|GG SALTED BUTTER 4CT|good & gather salted butter 4 sticks|1|ea|4.29|butter
Target|GG WHT SANDWICH BRD|good & gather white sandwich bread|1|ea|1.99|bread
Target|GG BLK FRST HAM 9OZ|good & gather black forest ham 9 oz|1|ea|3.99|deli meat
Target|GG CKN THIGH BNLS|good & gather boneless chicken thighs|1|ea|6.49|raw poultry
Target|GG PENNE 16OZ|good & gather penne 16 oz|2|ea|2.38|dry goods/grains
Target|2 @ 1.19|penne (qty detail line)|2|ea|2.38|dry goods/grains
Target|GG CHKN BROTH 32OZ|good & gather chicken broth 32 oz|1|ea|2.29|canned goods
Target|GG FRZN BROCCOLI FLRTS|good & gather frozen broccoli florets|1|ea|1.89|frozen foods
Target|DIGIORNO RSNG CRST PEPP|digiorno rising crust pepperoni pizza|1|ea|7.49|frozen foods
Target|TARGET CIRCLE 20% OFF|target circle offer|1|ea|-1.50|discount
Target|GG MAYO 30OZ|good & gather mayonnaise 30 oz|1|ea|3.79|opened condiments
Target|TOSTITOS SCOOPS|tostitos scoops tortilla chips|1|ea|5.29|snacks
Target|COKE 12PK 12OZ|coca-cola 12 pack cans|1|ea|8.49|beverages
Target|UP&UP PAPER TOWELS 6CT|up & up paper towels 6 ct|1|ea|8.99|non_food
Target|COLGATE TP 2PK|colgate toothpaste 2 pk|1|ea|6.79|non_food
Target|REDCARD 5% SAVINGS|target redcard 5% discount|1|ea|-2.73|discount
Target|GG HUMMUS ORIG 10OZ|good & gather original hummus 10 oz|1|ea|3.29|cooked leftovers
Target|BAG FEE|paper bag charge|3|ea|0.24|fee
"""
OBS = {"** KS TOWELS **": "https://www.reddit.com/r/Costco/comments/x6vqkt/what_does_the_two_asterisks_mean_on_my_receipt/",
       "KS Chic tort": "https://www.reddit.com/r/Costco/comments/qf2v0q/confusion_from_receipt/",
       "KS dbl roll": "https://www.reddit.com/r/Costco/comments/qf2v0q/confusion_from_receipt/"}
rows=[]
for line in RAW.strip().splitlines():
    s,raw,norm,q,u,p,c=line.split("|")
    r={"store":s,"raw_text":raw,"normalized_name":norm,"quantity":float(q) if "." in q else int(q),"unit":u or None,
       "price":float(p) if p else None,"category":c,"observed":raw in OBS}
    if raw in OBS: r["source_url"]=OBS[raw]
    rows.append(r)
doc={"_meta":{"description":"Receipt line-item fixtures for the Miple receipt parser. price = extended line amount in USD (negative for discounts/coupons). quantity/unit describe the purchase (lb for weight-priced lines). Lines like '2.41 lb @ 0.69 /lb' or '3 @ 1.99' are detail lines that print under an item on many POS systems; they carry the same item fields so a parser can merge them with the line above (detail lines have normalized_name ending in '(weight detail line)' or '(qty detail line)') - do not double count them.",
 "extra_categories":{"non_food":"household/personal-care items; not added to pantry","discount":"coupons, loyalty savings, instant savings (negative price); also non-monetary promo lines with price 0","deposit":"bottle deposit / CRV (WA has no bottle deposit; these lines model OR and CA store receipts)","fee":"carryout bag charge (WA: 8c paper / 12c reusable film plastic from 2026-01-01; subject to retail sales tax per WA DOR)"},
 "observed_sources":sorted(set(OBS.values())),
 "observed_note":"observed:true lines were typed by Reddit posters quoting their own Costco receipts (text only; no images saved). Prices for 'KS Chic tort' and 'KS dbl roll' were not given in the source, so price is null. The $18.79 for KS TOWELS is the poster's stated price. Costco item numbers on synthetic Costco lines are FAKE placeholders (do not look them up)."},
 "lines":rows}
json.dump(doc,open(OUT,"w"),indent=2)
from collections import Counter
print(len(rows), Counter(r["store"] for r in rows), sum(r["observed"] for r in rows))
