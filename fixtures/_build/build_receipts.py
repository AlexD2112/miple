import os
"""Generate 10 synthetic receipts (text) + expected.json. All arithmetic in Decimal.
Tax: Seattle combined rate 10.55% (WA DOR, effective 2026-01-01) applied to taxable lines only
(non-food, soft drinks, hot prepared food). Grocery food is exempt (RCW 82.08.0293). Bag charges ARE taxed (WA DOR reusable-bag-fees page)."""
import json
from decimal import Decimal as D, ROUND_HALF_UP
OUTDIR=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),"receipts")
RATE=D("0.1055")
def m(x): return D(x).quantize(D("0.01"))
def fmt(x): 
    x=m(x); return f"{x:.2f}" if x>=0 else f"{-x:.2f}-"
# item: dict(raw,norm,qty,unit,price,cat,tax(bool),detail(optional str), void(bool))
def I(raw,norm,qty,unit,price,cat,tax=False,detail=None,void=False):
    if cat=="fee": tax=True  # WA DOR: pass-through bag charge is subject to retail sales tax
    return dict(raw=raw,norm=norm,qty=qty,unit=unit,price=D(price),cat=cat,tax=tax,detail=detail,void=void)

def totals(items):
    live=[i for i in items if not i["void"]]
    sub=sum((i["price"] for i in live),D("0"))
    base=sum((i["price"] for i in live if i["tax"]),D("0"))
    tax=(base*RATE).quantize(D("0.01"),rounding=ROUND_HALF_UP)
    return sub,base,tax,sub+tax

W=40
def row(left,right,width=W): 
    return left[:width-len(right)-2].ljust(width-len(right))+right
def center(s,width=W): return s.center(width).rstrip()

RECEIPTS=[]
def receipt(fname,store,date,time_,header,items,flags=("T",""),style="std",coupon_section=None,footer=None):
    RECEIPTS.append(dict(fname=fname,store=store,date=date,time=time_,header=header,items=items,flags=flags,style=style,coupon_section=coupon_section,footer=footer or []))

# 1 Safeway - easy
receipt("01_safeway_easy.txt","Safeway","2026-09-12","18:42",
 ["SAFEWAY","Store 1551  Seattle WA","(206) 555-0141"],
 [I("ORG SPNCH 5OZ","organic baby spinach 5 oz",1,"ea","4.99","leafy greens"),
  I("BANANAS","bananas",2.41,"lb","1.66","other fresh fruit",detail="2.41 lb @ 0.69 /lb"),
  I("LUCERNE MLK 2% GAL","lucerne 2% milk gallon",1,"gal","4.29","milk"),
  I("LUCERNE LG EGGS 12CT","lucerne large eggs 12 ct",1,"dozen","3.99","eggs"),
  I("SIG SLCT BRD WHT","signature select white bread",1,"ea","3.49","bread"),
  I("CLUB CARD SAVINGS","club card savings",1,"ea","-0.50","discount"),
  I("KLEENEX 3PK","kleenex tissues 3 pk",1,"ea","6.99","non_food",tax=True),
  I("BAG FEE PAPER","paper bag charge",1,"ea","0.08","fee")],
 flags=("T","S"))
# 2 QFC - long coupon section
receipt("02_qfc_coupons.txt","QFC","2026-09-20","11:07",
 ["QFC","Quality Food Centers","Capitol Hill  Seattle WA","Your cashier was BOB"],
 [I("KRO ORG BABY SPINACH","kroger organic baby spinach",1,"ea","3.99","leafy greens"),
  I("STRAWBERRIES 1LB","strawberries 1 lb",1,"ea","3.99","berries"),
  I("KRO 2PCT MLK HG","kroger 2% milk half gallon",1,"ea","2.69","milk"),
  I("DARIGOLD BUTTER UNSLTD","darigold unsalted butter",1,"ea","5.49","butter"),
  I("KRO BLK BEANS 15OZ","kroger black beans 15 oz can",3,"ea","2.67","canned goods",detail="3 @ 0.89"),
  I("KRO FZN PEAS 12OZ","kroger frozen peas 12 oz",1,"ea","1.50","frozen foods"),
  I("TILLAMOOK ICE CRM 48OZ","tillamook ice cream 48 oz",1,"ea","5.99","frozen foods"),
  I("HEINZ KETCHUP 32OZ","heinz ketchup 32 oz",1,"ea","4.29","opened condiments"),
  I("BOUNTY SAS 6=15","bounty select-a-size paper towels",1,"ea","11.99","non_food",tax=True),
  I("SC STRAWBERRIES","store coupon strawberries",1,"ea","-1.00","discount"),
  I("KRO SAVINGS ICE CRM","kroger card savings ice cream",1,"ea","-1.00","discount"),
  I("DIGITAL CPN DARIGOLD","digital coupon darigold butter",1,"ea","-0.75","discount"),
  I("DIGITAL CPN BOUNTY","digital coupon bounty",1,"ea","-2.00","discount",tax=True),
  I("MFR CPN HEINZ","manufacturer coupon heinz",1,"ea","-0.50","discount"),
  I("BUY 5 SAVE 5 DIGITAL","mega event digital discount",1,"ea","-5.00","discount"),
  I("PAPER BAG","paper bag charge",2,"ea","0.16","fee")],
 flags=("T","F"),style="qfc")
# 3 Fred Meyer - voided item, weight produce
receipt("03_fredmeyer_void.txt","Fred Meyer","2026-10-01","19:55",
 ["FRED MEYER","Ballard  Seattle WA 98107","Store 0021"],
 [I("BROCCOLI CROWNS","broccoli crowns",1.47,"lb","2.92","other fresh vegetables",detail="1.47 lb @ 1.99 /lb"),
  I("GALA APPLES","gala apples",2.86,"lb","5.69","other fresh fruit",detail="2.86 lb @ 1.99 /lb"),
  I("CHOBANI GRK YGRT PLN 32","chobani plain greek yogurt 32 oz",1,"ea","5.99","yogurt"),
  I("CHOBANI GRK YGRT PLN 32","chobani plain greek yogurt 32 oz",1,"ea","5.99","yogurt",void=True),
  I("PORK LOIN CHOPS BNLS","boneless pork loin chops",2.04,"lb","8.14","raw whole cuts",detail="2.04 lb @ 3.99 /lb"),
  I("KRO JASMINE RICE 5LB","kroger jasmine rice 5 lb",1,"ea","6.99","dry goods/grains"),
  I("DAVES KLR BRD 21 GRN","dave's killer bread 21 whole grains",1,"ea","6.49","bread"),
  I("CPN DAVES KLR BRD","dave's killer bread coupon",1,"ea","-1.50","discount"),
  I("TIDE PODS 42CT","tide pods 42 ct",1,"ea","13.99","non_food",tax=True),
  I("LACROIX LIME 8PK","lacroix lime sparkling water 8 pk",1,"ea","4.99","beverages")],
 flags=("T","F"),style="fm")
# 4 Trader Joe's - easy
receipt("04_traderjoes_easy.txt","Trader Joe's","2026-10-03","13:21",
 ["TRADER JOE'S","1700 Madison St  Seattle WA (fictional #)","OPEN 8:00AM TO 9:00PM DAILY"],
 [I("BANANA EACH","banana",6,"ea","1.38","other fresh fruit",detail="6 @ 0.23"),
  I("BLUEBERRIES 18 OZ","blueberries 18 oz",1,"ea","4.99","berries"),
  I("TJ'S MANDARIN ORANGE CHKN","tj's mandarin orange chicken (frozen)",1,"ea","5.49","frozen foods"),
  I("EGGS LARGE BROWN CAGE FREE","large brown cage free eggs",1,"dozen","3.49","eggs"),
  I("GREEK NONFAT YOGURT PLAIN","tj's plain nonfat greek yogurt",1,"ea","4.49","yogurt"),
  I("TJ'S SPAGHETTI","tj's spaghetti",2,"ea","2.58","dry goods/grains",detail="2 @ 1.29"),
  I("FLOWERS SUNFLOWER BUNCH","sunflowers bouquet",1,"ea","4.99","non_food",tax=True),
  I("BAG CHARGE","paper bag charge",1,"ea","0.08","fee")],
 flags=("T",""),style="tj")
# 5 Costco - item numbers, instant savings
receipt("05_costco_instant_savings.txt","Costco","2026-10-04","10:34",
 ["COSTCO","WHOLESALE","Seattle #0001 (fictional)","4401 4th Ave S  Seattle WA"],
 [I("1170000 KS ROTIS CHKN","kirkland signature rotisserie chicken",1,"ea","4.99","cooked leftovers",tax=True),
  I("1092000 KS ORG EGGS 24CT","kirkland signature organic eggs 24 ct",1,"ea","8.49","eggs"),
  I("1110001 BLUEBERRY 18OZ","blueberries 18 oz",2,"ea","11.98","berries",detail="2 @ 5.99"),
  I("0000355 TPD/BLUEBERRY","instant savings blueberries",1,"ea","-2.00","discount"),
  I("1150001 KS BNLS SKNLS CHKN BRST","kirkland boneless skinless chicken breast",6.20,"lb","23.81","raw poultry"),
  I("1160000 KS JASMINE RICE 25LB","kirkland jasmine rice 25 lb",1,"ea","19.99","dry goods/grains"),
  I("1191001 KS BATH TISSUE 30RL","kirkland bath tissue 30 rolls",1,"ea","23.99","non_food",tax=True),
  I("0000356 TPD/KS BATH","instant savings bath tissue",1,"ea","-4.00","discount",tax=True)],
 flags=("A","E"),style="costco")
# 6 Whole Foods - prime, hot bar
receipt("06_wholefoods_hotbar.txt","Whole Foods","2026-10-06","12:15",
 ["WHOLE FOODS MARKET","South Lake Union  Seattle WA","(206) 555-0199"],
 [I("ORG RASPBERRIES 6OZ","organic raspberries 6 oz",1,"ea","4.99","berries"),
  I("PRIME MEMBER DEAL","prime member savings",1,"ea","-1.50","discount"),
  I("ORG GALA APPLE","organic gala apples",1.65,"lb","4.11","other fresh fruit",detail="1.65 lb @ 2.49 /lb"),
  I("365 WHL MILK HG","365 whole milk half gallon",1,"ea","3.49","milk"),
  I("PARMIGIANO REGGIANO","parmigiano reggiano wedge",0.45,"lb","10.35","hard cheese",detail="0.45 lb @ 22.99 /lb"),
  I("WILD COD FILLET","wild cod fillet",0.74,"lb","9.62","raw fish",detail="0.74 lb @ 12.99 /lb"),
  I("HOT BAR","hot bar prepared food by weight",1.06,"lb","12.71","cooked leftovers",tax=True,detail="1.06 lb @ 11.99 /lb"),
  I("365 ORG EXT FIRM TOFU","365 organic extra firm tofu",1,"ea","2.49","tofu"),
  I("SEVENTH GEN DISH SOAP","seventh generation dish soap",1,"ea","4.49","non_food",tax=True)],
 flags=("T","F"),style="wf")
# 7 Target - mixed taxable
receipt("07_target_mixed.txt","Target","2026-10-08","20:03",
 ["TARGET","Seattle Northgate (fictional)","206-555-0177"],
 [I("GG BABY SPINACH 5OZ","good & gather baby spinach 5 oz",1,"ea","2.99","leafy greens"),
  I("GG 2% MILK GAL","good & gather 2% milk gallon",1,"ea","3.69","milk"),
  I("GG PENNE 16OZ","good & gather penne 16 oz",2,"ea","2.38","dry goods/grains",detail="2 @ 1.19"),
  I("DIGIORNO RSNG CRST PEPP","digiorno rising crust pepperoni pizza",1,"ea","7.49","frozen foods"),
  I("TARGET CIRCLE 20% OFF","target circle offer",1,"ea","-1.50","discount"),
  I("COKE 12PK 12OZ","coca-cola 12 pack cans",1,"ea","8.49","beverages",tax=True),
  I("UP&UP PAPER TOWELS 6CT","up & up paper towels 6 ct",1,"ea","8.99","non_food",tax=True),
  I("BAG FEE","paper bag charge",1,"ea","0.08","fee")],
 flags=("T","N"),style="target")
# 8 Safeway - messy OCR-like, multi-buy
receipt("08_safeway_messy.txt","Safeway","2026-10-10","21:48",
 ["SAFEWAY  ","Store 3O18  Seattle W A","  (206) 555-O163"],
 [I("2 @ 2 FOR 5.00 BARILLA PENNE","barilla penne",2,"ea","5.00","dry goods/grains"),
  I("FSTR FRMS BNLS BRST","foster farms boneless skinless chicken breast",1.87,"lb","9.33","raw poultry",detail="1.87 lb @ 4.99 /lb"),
  I("AVOCADOS HASS LG","hass avocado large",3,"ea","5.97","other fresh fruit",detail="3 @ 1.99"),
  I("J4U DIGITAL CPN","just for u digital coupon",1,"ea","-1.00","discount"),
  I("CABOT SHRP CHDR 8OZ","cabot sharp cheddar 8 oz",1,"ea","4.49","hard cheese"),
  I("SIG KTCHNS TORT FLR 10CT","signature kitchens flour tortillas 10 ct",1,"ea","2.99","tortillas"),
  I("CILANTRO","cilantro bunch",1,"ea","0.99","fresh herbs"),
  I("SW DELI TRKY BRST SLCD","deli sliced turkey breast",0.62,"lb","7.44","deli meat",detail="0.62 lb @ 11.99 /lb"),
  I("PEPSI 12PK 12OZ CAN","pepsi 12 pack cans",1,"ea","7.99","beverages",tax=True),
  I("CLUB CARD SAVINGS","club card savings",1,"ea","-2.00","discount",tax=True)],
 flags=("T","S"),style="messy")
# 9 Costco - big haul
receipt("09_costco_big.txt","Costco","2026-10-12","15:10",
 ["COSTCO","WHOLESALE","Seattle #0001 (fictional)","4401 4th Ave S  Seattle WA"],
 [I("1201000 ORG SPRING MIX 1LB","organic spring mix 1 lb",1,"ea","4.99","leafy greens"),
  I("1110000 STRAWBERRIES 2LB","strawberries 2 lb",1,"ea","5.99","berries"),
  I("1131000 KS 2% MILK 2/1GAL","kirkland signature 2% milk 2 x 1 gal",1,"ea","6.49","milk"),
  I("1122000 KS BUTTER UNSALTD 4LB","kirkland signature unsalted butter 4 x 1 lb",1,"ea","12.99","butter"),
  I("1123000 KS GRK YOGURT 48OZ","kirkland signature greek yogurt 48 oz",1,"ea","6.99","yogurt"),
  I("1124000 TILLAMOOK MED CHED 2.5LB","tillamook medium cheddar 2.5 lb",1,"ea","10.99","hard cheese"),
  I("1150000 KS GRND BEEF 88/12","kirkland ground beef 88/12",4.12,"lb","20.56","raw ground meat"),
  I("1150002 ATL SALMON FILLET","atlantic salmon fillet",3.05,"lb","30.47","raw fish"),
  I("1161000 KS ORG BLK BEANS 8PK","kirkland organic black beans 8 cans",1,"ea","10.49","canned goods"),
  I("1170001 KS CROISSANT 12CT","kirkland croissants 12 ct",1,"ea","6.99","bread"),
  I("1180000 MISSION FLR TORT 40CT","mission flour tortillas 40 ct",1,"ea","6.99","tortillas"),
  I("1190000 KS FRZN BERRIES 4LB","kirkland frozen three berry blend 4 lb",1,"ea","12.99","frozen foods"),
  I("1190001 BIBIGO MANDU 6LB","bibigo pork mandu dumplings 6 lb",1,"ea","15.99","frozen foods"),
  I("1191000 KS WATER 40PK","kirkland bottled water 40 pk",1,"ea","4.99","beverages")],
 flags=("A","E"),style="costco")
# 10 Trader Joe's - tiny
receipt("10_traderjoes_tiny.txt","Trader Joe's","2026-10-14","08:12",
 ["TRADER JOE'S","1700 Madison St  Seattle WA (fictional #)"],
 [I("ORGANIC BABY SPINACH","tj's organic baby spinach",1,"ea","2.49","leafy greens"),
  I("SOURDOUGH SLICED PAN","tj's sliced sourdough pan loaf",1,"ea","3.49","bread")],
 flags=("T",""),style="tj")

def render(r):
    sub,base,tax,total=totals(r["items"])
    tf,ef=r["flags"]; L=[]
    for h in r["header"]: L.append(center(h))
    L.append("")
    mmddyy=f'{r["date"][5:7]}/{r["date"][8:10]}/{r["date"][2:4]}'
    if r["style"] in ("costco",):
        L.append(row("E  MEMBER ************","")); L.append("")
    coupons=[i for i in r["items"] if r["style"]=="qfc" and i["cat"]=="discount"]
    body=[i for i in r["items"] if i not in coupons]
    count=0; order=[]
    for i in body:
        flag=tf if i["tax"] else ("" if i["cat"] in ("fee","deposit","discount") else ef)
        price=fmt(i["price"])+(" "+flag if flag else "  ")
        raw=i["raw"]
        if r["style"]=="messy":
            raw=raw.replace("O","0").replace(" ","  ",1)
        raw=raw[:W-len(price)-2].rstrip()
        i["printed"]=raw; order.append(i)
        if i["detail"] and r["style"] in ("std","messy","fm","wf","qfc","target","tj"):
            L.append("  "+i["detail"])
            L.append(row(raw,price))
        elif i["detail"]:
            L.append(row(raw,price)); L.append("     "+i["detail"])
        else:
            L.append(row(raw,price))
        if i["void"]:
            L.append(row("** VOID ** "+i["raw"][:18],fmt(-i["price"])+"  "))
        if not i["void"] and i["cat"] not in ("discount","fee","deposit"):
            count+= i["qty"] if isinstance(i["qty"],int) and i["unit"] in ("ea","dozen","gal") else 1
    if coupons:
        L.append(""); L.append(center("**** COUPONS & SAVINGS ****"))
        for c in coupons:
            c["printed"]=c["raw"][:W-len(fmt(c["price"]))-4].rstrip(); order.append(c)
            L.append(row(c["raw"],fmt(c["price"])+(" "+tf if c["tax"] else "  ")))
        L.append(row("TOTAL COUPONS",fmt(sum(c["price"] for c in coupons))+"  "))
        L.append(center("************************"))
    L.append("")
    if r["style"]=="costco":
        L.append(row("SUBTOTAL",fmt(sub))); L.append(row("TAX",fmt(tax))); L.append(row("**** TOTAL",fmt(total)))
        L.append("")
        L.append(row(f"A {RATE*100:.2f}% TAX",fmt(tax)))
        L.append(row("TOTAL TAX",fmt(tax)))
        L.append(row("TOTAL NUMBER OF ITEMS SOLD =",str(count)))
    else:
        L.append(row("SUBTOTAL",fmt(sub)))
        L.append(row(f"TAX {RATE*100:.2f}% ON {fmt(base)}",fmt(tax)))
        L.append(row("**** BALANCE" if r["style"] in ("std","messy") else "TOTAL",fmt(total)))
    L.append(row("VISA TEND",fmt(total)))
    L.append(row("CHANGE","0.00"))
    L.append("")
    L.append(row("CARD # ************","CHIP"))
    if r["style"]=="tj":
        L.append(row(f"{mmddyy} {r['time']}",f"ITEMS {count}"))
    elif r["style"]=="target":
        L.append(row(f"{mmddyy} {r['time']}","TOTAL ITEMS "+str(count)))
    else:
        L.append(f"{mmddyy} {r['time']}  ITEMS {count}")
    tf_note=f"{tf}=TAXABLE" + (f"  {ef}=NONTAXABLE FOOD" if ef else "")
    L.append(tf_note)
    if r["style"]=="tj": L.append(center("THANK YOU FOR SHOPPING AT"));L.append(center("TRADER JOE'S"))
    else: L.append(center("THANK YOU"))
    r["order"]=order
    return "\n".join(L)+"\n",sub,tax,total

expected={}
for r in RECEIPTS:
    txt,sub,tax,total=render(r)
    open(f'{OUTDIR}/{r["fname"]}',"w").write(txt)
    expected[r["fname"]]={"store":r["store"],"date":r["date"],
      "items":[{"store":r["store"],"raw_text":i["printed"],"normalized_name":i["norm"],"quantity":i["qty"],"unit":i["unit"],
                "price":float(i["price"]),"category":i["cat"],"taxable":i["tax"]} for i in r["order"] if not i["void"]],
      "voided_lines":[{"raw_text":i["raw"],"price":float(i["price"])} for i in r["items"] if i["void"]],
      "subtotal":float(sub),"tax":float(tax),"total":float(total),
      "taxable_base":float(sum((i["price"] for i in r["items"] if i["tax"] and not i["void"]),D(0))),"tax_rate":float(RATE)}
json.dump({"_meta":{"tax_rate":0.1055,"tax_rule":"Seattle 2026 combined rate 10.55% on taxable lines (non_food, soft drinks, hot prepared food); grocery food exempt; carryout bag charges are taxable per WA DOR. subtotal = sum of all non-voided line prices (incl. negative discounts, fees, deposits). total = subtotal + tax.","note":"Detail lines like '2.41 lb @ 0.69 /lb' or '3 @ 1.99' are merged into the item they describe. Voided items are excluded from items and listed in voided_lines.","dates":"ISO 8601 (receipts print MM/DD/YY)"},"receipts":expected},open(f"{OUTDIR}/expected.json","w"),indent=2)
for k,v in expected.items(): print(k,len(v["items"]),v["subtotal"],v["tax"],v["total"])
