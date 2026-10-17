import { supabase } from "./supabase";
import type { Macros, ParsedReceipt, Recipe } from "./types";

const API_URL = process.env.EXPO_PUBLIC_API_URL!;

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("not signed in");
  return { Authorization: `Bearer ${token}` };
}

async function check<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ? JSON.stringify(body.error) : `HTTP ${res.status}`);
  return body as T;
}

export async function parseReceipt(imageUri: string, mimeType = "image/jpeg"): Promise<ParsedReceipt> {
  const form = new FormData();
  // React Native's FormData accepts { uri, name, type } file descriptors.
  form.append("image", { uri: imageUri, name: "receipt.jpg", type: mimeType } as unknown as Blob);
  const res = await fetch(`${API_URL}/receipts/parse`, {
    method: "POST",
    headers: await authHeader(),
    body: form,
  });
  return check(res);
}

export interface PantryForLLM {
  id: string;
  name: string;
  category: string;
  quantity: number;
  unit: string | null;
  days_left: number;
}

export interface ChefApplied {
  slot_id: string;
  action: "replace" | "skip";
  title: string | null;
}

export async function chatWithChef(input: {
  messages: { role: "user" | "chef"; text: string }[];
  plan: {
    slot_id: string;
    starts_at: string;
    ends_at: string;
    minutes_available: number;
    title: string;
    minutes: number;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    ingredients: string[];
  }[];
  pantry: PantryForLLM[];
  remaining: Macros;
}): Promise<{ message: string; applied: ChefApplied[]; rejected: number }> {
  const res = await fetch(`${API_URL}/recipes/chef`, {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return check(res);
}

export async function generateRecipes(input: {
  pantry: PantryForLLM[];
  remaining: Macros; // four numbers, never raw HealthKit samples
  max_minutes: number;
  count: number;
}): Promise<{ recipes: Recipe[]; rejected: number }> {
  const res = await fetch(`${API_URL}/recipes/generate`, {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return check(res);
}
