"""Shared core for fixtures/large3. Reuses batch-1/2 code READ-ONLY (no bytecode written). Reads labels only from
../../shelf_life.json, ../../allergens.json and the app code (server/src/domain/allergens.ts, supabase/migrations/0001_init.sql)."""
import sys, os, re, json, random, datetime as dt
sys.dont_write_bytecode = True
GEN3 = os.path.dirname(os.path.abspath(__file__)); LARGE3 = os.path.dirname(GEN3); FIXDIR = os.path.dirname(LARGE3); REPO = os.path.dirname(FIXDIR)
sys.path.insert(0, os.path.join(FIXDIR, "large2", "_gen")); sys.path.insert(0, os.path.join(FIXDIR, "large", "_gen"))
from common import *  # noqa  SEED, CATALOG, CATS, SHELF, money, store_raw, LOCATIONS, STORES ...
from decimal import Decimal as D, ROUND_HALF_UP
SEED3 = SEED + 3_000_000

def jdump(path, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for r in rows: f.write(json.dumps(r, separators=(",", ":"), ensure_ascii=False) + "\n")

def app_shelf_days():
    """category -> days, parsed from supabase/migrations/0001_init.sql (the app's shelf_life table)."""
    sql = open(os.path.join(REPO, "supabase", "migrations", "0001_init.sql")).read()
    block = sql.split("insert into public.shelf_life", 1)[1].split(";", 1)[0]
    return {k: int(v) for k, v in re.findall(r"\('([a-z_]+)',\s*(\d+)\)", block)}
APP_DAYS = app_shelf_days()
APP_CATEGORIES = re.findall(r'"([a-z_]+)"', open(os.path.join(REPO, "server", "src", "domain", "schemas.ts")).read().split("CATEGORIES = [", 1)[1].split("]", 1)[0])
assert set(APP_CATEGORIES) == set(APP_DAYS), "schemas.ts CATEGORIES != shelf_life table"
