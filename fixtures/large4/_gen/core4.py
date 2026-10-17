"""Shared core for fixtures/large4. Reuses batch-1/2/3 code READ-ONLY (sys.dont_write_bytecode, nothing in earlier folders is written).
Labels come only from fixtures/shelf_life.json, fixtures/allergens.json and the app code."""
import sys, os
sys.dont_write_bytecode = True
GEN4 = os.path.dirname(os.path.abspath(__file__)); LARGE4 = os.path.dirname(GEN4)
sys.path.insert(0, os.path.join(os.path.dirname(LARGE4), "large3", "_gen"))
from core3 import *  # noqa: SEED, SEED3, REPO, FIXDIR, APP_DAYS, APP_CATEGORIES, jdump, CATS, SHELF, ...
SEED4 = SEED + 4_000_000
