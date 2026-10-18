import { Router } from "express";
import { z } from "zod";
import { requireUser } from "../lib/supabase.js";
import { guessCategory } from "../domain/category.js";

export const items = Router();

const CategoryRequest = z.object({ name: z.string().min(1).max(120) });

/** POST /items/category { name }: pantry category for a manually added item. */
items.post("/category", requireUser, async (req, res) => {
  const body = CategoryRequest.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: body.error.flatten() });
  res.json(await guessCategory(body.data.name));
});
