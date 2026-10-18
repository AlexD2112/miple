import { findAllergens } from "./allergens.js";

/**
 * Small, deterministic checks between the model and the database. Each one comes from a failing
 * case in miple-testdata (large5 receipt_pipeline and quantity_regression).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_QUANTITY = 10_000;
export const MAX_PRICE = 10_000;
/** Pantry items sent to the model per request; the most urgent are kept. */
export const PANTRY_PROMPT_CAP = 150;
/** Receipts older than this are treated as a misread date. */
const MAX_RECEIPT_AGE_DAYS = 90;

/** YYYY-MM-DD that is a real calendar day. `Date.parse("2026-02-30")` quietly returns March 2, so check the parts. */
export function isValidIsoDate(s: string | null | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Today in the user's time zone, not UTC (in Seattle, UTC is already tomorrow by 5 PM). */
export function localToday(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(now);
  }
}

/** The printed purchase date when it is real and plausible, otherwise the user's local today. */
export function purchaseDateOrToday(printed: string | null, timeZone: string, now = new Date()): string {
  const today = localToday(timeZone, now);
  if (!isValidIsoDate(printed)) return today;
  const ageDays = (Date.parse(today) - Date.parse(printed)) / DAY_MS;
  // A date in the future or months ago is almost always an OCR misread (e.g. 10/15/26 read as 2016).
  if (ageDays < 0 || ageDays > MAX_RECEIPT_AGE_DAYS) return today;
  return printed;
}

/** Positive, at most MAX_QUANTITY, 3 decimals. A misread like a UPC becoming a quantity falls back to 1. */
export function cleanQuantity(q: number | null | undefined): number {
  if (typeof q !== "number" || !Number.isFinite(q) || q <= 0 || q > MAX_QUANTITY) return 1;
  return Math.max(0.001, Math.round(q * 1000) / 1000);
}

/** Non-negative, at most MAX_PRICE, cents. Anything else becomes null rather than failing the save. */
export function cleanPrice(p: number | null | undefined): number | null {
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > MAX_PRICE) return null;
  return Math.round(p * 100) / 100;
}

export interface PantryEntry {
  id: string;
  name: string;
  days_left: number;
}

/**
 * What the model sees of the pantry: no allergens, nothing already expired, most urgent first,
 * capped so a big pantry can't fail the request.
 */
export function pantryForPrompt<T extends PantryEntry>(pantry: T[], allergies: string[], cap = PANTRY_PROMPT_CAP): T[] {
  return pantry
    .filter((p) => p.days_left >= 0)
    .filter((p) => findAllergens([p.name], allergies).length === 0)
    .sort((a, b) => a.days_left - b.days_left)
    .slice(0, cap);
}
