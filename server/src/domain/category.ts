import { z } from "zod";
import { matchReceiptLine, NUTRITION_REVIEW_THRESHOLD } from "./nutrition.js";
import { CATEGORIES } from "./schemas.js";

export type Category = (typeof CATEGORIES)[number];

export interface CategoryGuess {
  category: Category;
  /** "matcher" = USDA alias table, "llm" = Gemini fallback, "default" = nothing worked. */
  source: "matcher" | "llm" | "default";
  confidence: number;
}

const LlmCategory = z.object({ category: z.enum(CATEGORIES) });

const SYSTEM = `You file one grocery item into a pantry category. The category sets its expiry date, so be accurate:
raw chicken or turkey -> raw_poultry, raw beef/pork/lamb -> raw_meat, fish and shellfish -> raw_seafood.
Pick the closest category from: ${CATEGORIES.join(", ")}.`;

type Llm = (name: string) => Promise<Category>;

const isCategory = (c: string): c is Category => (CATEGORIES as readonly string[]).includes(c);

/**
 * Category for a manually added item: the USDA matcher when it is confident, otherwise an LLM.
 * Never throws; falls back to "other".
 */
export async function guessCategory(name: string, llm?: Llm): Promise<CategoryGuess> {
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) return { category: "other", source: "default", confidence: 0 };

  const match = matchReceiptLine(trimmed);
  if (match && match.confidence >= NUTRITION_REVIEW_THRESHOLD && isCategory(match.row.category)) {
    return { category: match.row.category, source: "matcher", confidence: match.confidence };
  }

  try {
    const category = await (llm ?? geminiCategory)(trimmed);
    return { category, source: "llm", confidence: 0.8 };
  } catch (err) {
    // A weak matcher guess can be badly wrong ("leftover pad thai" -> dry_goods, 180 days), so use the 7-day default.
    console.warn("[category] LLM fallback failed", err);
    return { category: "other", source: "default", confidence: 0 };
  }
}

async function geminiCategory(name: string): Promise<Category> {
  const { structured } = await import("../lib/gemini.js");
  const out = await structured(LlmCategory, { system: SYSTEM, content: `Item: ${JSON.stringify(name)}` });
  return out.category;
}
