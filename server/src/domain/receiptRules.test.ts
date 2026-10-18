import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanPrice, cleanQuantity, isValidIsoDate, localToday, pantryForPrompt, purchaseDateOrToday } from "./receiptRules.js";

test("impossible dates are rejected (Date.parse accepts Feb 30)", () => {
  assert.equal(isValidIsoDate("2026-02-30"), false);
  assert.equal(isValidIsoDate("2026-13-01"), false);
  assert.equal(isValidIsoDate("2026-10-15"), true);
  assert.equal(isValidIsoDate("2028-02-29"), true);
  assert.equal(isValidIsoDate(null), false);
});

test("today is the user's local date, not UTC", () => {
  // 6:30 PM in Seattle on Oct 17 is already Oct 18 in UTC.
  const now = new Date("2026-10-18T01:30:00Z");
  assert.equal(localToday("America/Los_Angeles", now), "2026-10-17");
  assert.equal(localToday("Not/AZone", now), "2026-10-17");
});

test("purchase date falls back to local today when missing, impossible, future or ancient", () => {
  const now = new Date("2026-10-18T01:30:00Z");
  const tz = "America/Los_Angeles";
  assert.equal(purchaseDateOrToday("2026-10-15", tz, now), "2026-10-15");
  assert.equal(purchaseDateOrToday(null, tz, now), "2026-10-17");
  assert.equal(purchaseDateOrToday("2026-02-30", tz, now), "2026-10-17");
  assert.equal(purchaseDateOrToday("2026-10-25", tz, now), "2026-10-17");
  assert.equal(purchaseDateOrToday("2016-10-15", tz, now), "2026-10-17");
});

test("quantities and prices are clamped instead of failing the save", () => {
  assert.equal(cleanQuantity(1.52), 1.52);
  assert.equal(cleanQuantity(0.0011), 0.001);
  assert.equal(cleanQuantity(41130000000), 1); // UPC read as a quantity
  assert.equal(cleanQuantity(-2), 1);
  assert.equal(cleanQuantity(Number.NaN), 1);
  assert.equal(cleanPrice(7.578), 7.58);
  assert.equal(cleanPrice(-1), null);
  assert.equal(cleanPrice(123456789), null);
  assert.equal(cleanPrice(null), null);
});

test("pantry sent to the model: no expired, no allergens, most urgent first, capped", () => {
  const pantry = [
    { id: "a", name: "milk", days_left: 3 },
    { id: "b", name: "spinach", days_left: -1 },
    { id: "c", name: "chicken", days_left: 1 },
    { id: "d", name: "peanut butter", days_left: 60 },
    ...Array.from({ length: 300 }, (_, i) => ({ id: `x${i}`, name: `rice ${i}`, days_left: 100 + i })),
  ];
  const out = pantryForPrompt(pantry, ["peanut"]);
  assert.equal(out.length, 150);
  assert.deepEqual(out.slice(0, 2).map((p) => p.id), ["c", "a"]);
  assert.ok(!out.some((p) => p.id === "b"), "expired item kept");
  assert.ok(!out.some((p) => p.id === "d"), "allergen kept");
});
