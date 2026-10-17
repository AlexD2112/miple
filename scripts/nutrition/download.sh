#!/usr/bin/env bash
# Download + unpack the USDA FoodData Central bulk CSVs used by build_nutrition.py (public domain, no API key).
set -euo pipefail
base=https://fdc.nal.usda.gov/fdc-datasets
curl -fsSLO "$base/FoodData_Central_foundation_food_csv_2026-04-30.zip"
curl -fsSLO "$base/FoodData_Central_sr_legacy_food_csv_2018-04.zip"
unzip -oq FoodData_Central_foundation_food_csv_2026-04-30.zip && rm -rf ff && mv FoodData_Central_foundation_food_csv_2026-04-30 ff
unzip -oq FoodData_Central_sr_legacy_food_csv_2018-04.zip && rm -rf sr && mv FoodData_Central_sr_legacy_food_csv_2018-04 sr
