import { createClient } from "@supabase/supabase-js";
import type { NextFunction, Request, Response } from "express";
import { env } from "../env.js";

// Service-role client: bypasses RLS. Every query must filter by user_id explicitly.
export const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface AuthedRequest extends Request {
  userId?: string;
}

/** Verifies the Supabase access token the app sends as `Authorization: Bearer <jwt>`. */
export async function requireUser(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ error: "missing bearer token" });

  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: "invalid token" });

  req.userId = data.user.id;
  next();
}

export interface Profile {
  id: string;
  diet: string;
  allergies: string[];
  dislikes: string[];
  calorie_target: number;
  protein_target_g: number;
  carbs_target_g: number;
  fat_target_g: number;
  phone: string | null;
  nudges_enabled: boolean;
  allow_staples: boolean;
  timezone: string;
}

export async function getProfile(userId: string): Promise<Profile> {
  const { data, error } = await db.from("profiles").select("*").eq("id", userId).single();
  if (error) throw error;
  return data as Profile;
}

let shelfLifeCache: Map<string, number> | null = null;

export async function getShelfLife(): Promise<Map<string, number>> {
  if (shelfLifeCache) return shelfLifeCache;
  const { data, error } = await db.from("shelf_life").select("category, days");
  if (error) throw error;
  shelfLifeCache = new Map(data.map((row) => [row.category as string, row.days as number]));
  return shelfLifeCache;
}
