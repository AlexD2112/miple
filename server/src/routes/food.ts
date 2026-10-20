import { Router } from "express";
import multer from "multer";
import { structured, type UserPart } from "../lib/gemini.js";
import { answerAuditProbe, isAuditProbe } from "../lib/audit.js";
import { requireUser } from "../lib/supabase.js";
import { screenInput } from "../domain/guard.js";
import { sniffImageFormat } from "../domain/imageFormat.js";
import { searchNutrition } from "../domain/nutrition.js";
import { cleanEstimate, FOOD_SYSTEM, FoodEstimate, fromOpenFoodFacts, normalizeBarcode, type BarcodeFood } from "../domain/food.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

export const food = Router();

/**
 * POST /food/estimate: calories and macros for a meal photo, a Nutrition Facts label, or a typed description.
 * Multipart (`image`, optional `text`) or JSON `{ text }`. Nothing is saved; the app shows the items for review.
 */
food.post(
  "/estimate",
  (req, res, next) => {
    if (isAuditProbe(req)) return answerAuditProbe(req, res, next);
    return requireUser(req, res, () => upload.single("image")(req, res, next));
  },
  async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 600) : "";
    const file = req.file;
    if (!file && !text) return res.status(400).json({ error: "Send a photo or describe what you ate." });

    if (text) {
      const refusal = screenInput(text);
      if (refusal) return res.status(400).json({ error: refusal.message });
    }

    const content: UserPart[] = [];
    if (file) {
      const mime = sniffImageFormat(file.buffer);
      if (!mime) return res.status(415).json({ error: "Unsupported image. Upload a JPEG, PNG, WebP or HEIC photo." });
      content.push({ inlineData: { mimeType: mime, data: file.buffer.toString("base64") } });
      content.push({ text: text ? `Photo of what I ate. My note: ${text}` : "Photo of what I ate, or of a nutrition label." });
    } else {
      content.push({ text: `What I ate: ${text}` });
    }

    const out = await structured(FoodEstimate, { system: FOOD_SYSTEM, content, maxOutputTokens: 4000 });
    const items = out.kind === "not_food" ? [] : out.items.slice(0, 20).map(cleanEstimate);
    res.json({ kind: items.length ? out.kind : "not_food", title: out.title.trim().slice(0, 80), items });
  },
);

/** GET /food/search?q=: USDA foods matching a typed search, per 100 g as sold (raw or dry). */
food.get("/search", requireUser, (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  if (q.length < 2) return res.json({ results: [] });
  res.json({ results: searchNutrition(q, 10) });
});

const barcodeCache = new Map<string, BarcodeFood | null>();

/** GET /food/barcode/:code: product name and nutrition from Open Food Facts. 404 when it isn't listed. */
food.get("/barcode/:code", requireUser, async (req, res) => {
  const code = normalizeBarcode(String(req.params.code ?? ""));
  if (!code) return res.status(400).json({ error: "That isn't a barcode number." });

  if (!barcodeCache.has(code)) {
    try {
      const r = await fetch(
        `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,generic_name,brands,serving_size,serving_quantity,nutriments`,
        { headers: { "User-Agent": "Ripe/1.0 (https://ripe.cooking)" }, signal: AbortSignal.timeout(8000) },
      );
      if (!r.ok && r.status !== 404) throw new Error(`Open Food Facts HTTP ${r.status}`);
      const body = (await r.json().catch(() => ({}))) as { status?: number; product?: Record<string, unknown> };
      if (barcodeCache.size > 2000) barcodeCache.clear();
      barcodeCache.set(code, body.status === 1 ? fromOpenFoodFacts(code, body.product) : null);
    } catch (err) {
      console.warn("[barcode] lookup failed", err);
      return res.status(502).json({ error: "Couldn't reach the food database. Try again, or snap the nutrition label." });
    }
  }
  const hit = barcodeCache.get(code);
  if (!hit) return res.status(404).json({ error: "That product isn't in the food database yet. Snap its nutrition label instead." });
  res.json(hit);
});
