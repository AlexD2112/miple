import { Router } from "express";
import multer from "multer";
import { structured, type UserPart } from "../lib/gemini.js";
import { answerAuditProbe, isAuditProbe } from "../lib/audit.js";
import { perceptronOcr } from "../lib/perceptron.js";
import { getProfile, getShelfLife, requireUser, type AuthedRequest } from "../lib/supabase.js";
import { cleanPrice, cleanQuantity, purchaseDateOrToday } from "../domain/receiptRules.js";
import { nutritionForItem } from "../domain/nutrition.js";
import { itemShelfLife } from "../domain/shelfLife.js";
import { CATEGORIES, ParsedReceipt, type ItemNutrition } from "../domain/schemas.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const SYSTEM = `You turn grocery receipts into pantry items.
Expand abbreviations into plain food names ("ORG SPNCH 5OZ" -> name "organic spinach", quantity 5, unit "oz").
Pick the closest category from: ${CATEGORIES.join(", ")}.
Mark bags, bottle deposits, coupons, tax, and non-food products with is_food=false.
Never invent items that are not on the receipt.`;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type ImageType = (typeof IMAGE_TYPES)[number];

export const receipts = Router();

/** The app sends multipart with a Supabase bearer token; everything else needs the audit token. */
receipts.post("/parse", (req, res, next) => {
  if (isAuditProbe(req)) return answerAuditProbe(req, res, next);
  return requireUser(req, res, () => upload.single("image")(req, res, next));
}, async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "expected multipart field 'image'" });
  const mime = (IMAGE_TYPES as readonly string[]).includes(file.mimetype)
    ? (file.mimetype as ImageType)
    : "image/jpeg";

  // 1. Perceptron OCR, 2. Gemini normalization. Without Perceptron, Gemini reads the image directly.
  const ocrText = await perceptronOcr(file.buffer, mime);
  const content: UserPart[] = ocrText
    ? [{ text: `Receipt text from OCR:\n\n${ocrText}` }]
    : [
        { inlineData: { mimeType: mime, data: file.buffer.toString("base64") } },
        { text: "Read this grocery receipt." },
      ];

  const parsed = await structured(ParsedReceipt, { system: SYSTEM, content });
  const shelfLife = await getShelfLife();
  // Real, plausible printed date, else the user's local today (not UTC).
  const timeZone = await getProfile((req as AuthedRequest).userId!)
    .then((p) => p.timezone)
    .catch(() => "America/Los_Angeles");
  const purchaseDate = purchaseDateOrToday(parsed.purchased_at, timeZone);

  res.json({
    ocr: ocrText ? "perceptron" : "gemini_vision",
    store: parsed.store,
    purchased_at: purchaseDate,
    total: cleanPrice(parsed.total),
    items: parsed.items
      .filter((i) => i.is_food)
      .map((i) => {
        // Per-item USDA FoodKeeper shelf life when the item matches a product, else the category's.
        const usda = itemShelfLife(i.name, i.category);
        return withNutrition({
          ...i,
          // One misread quantity (e.g. a UPC) used to overflow numeric(10,2) and fail the whole receipt save.
          quantity: cleanQuantity(i.quantity),
          price: cleanPrice(i.price),
          purchase_date: purchaseDate,
          estimated_expiry: addDays(purchaseDate, usda?.days ?? shelfLife.get(i.category) ?? 7),
          ...(usda ? { shelf_life: { days: usda.days, storage: usda.storage, source: usda.source, product: usda.product } } : {}),
        });
      }),
  });
});

/** Adds an optional `nutrition` field (USDA macros per 100 g). Items without a match are returned unchanged. */
export function withNutrition<T extends { raw_name: string; name: string }>(item: T): T | (T & { nutrition: ItemNutrition }) {
  const nutrition = nutritionForItem(item);
  return nutrition ? { ...item, nutrition } : item;
}


function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
