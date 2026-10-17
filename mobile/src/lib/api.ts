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

export interface CookStep {
  phase: "prep" | "cook";
  text: string;
  timer_minutes: number | null;
}

export interface IngredientGap {
  name: string;
  quantity: string;
  status: "have" | "need" | "substitute";
  pantry_item_id: string | null;
  substitute: string | null;
  note: string;
}

export interface ChefProposal {
  action: "add" | "replace" | "skip";
  replaces_slot_id: string | null;
  starts_at: string;
  ends_at: string;
  recipe: {
    title: string;
    minutes: number;
    servings: number;
    ingredients: { pantry_item_id: string | null; name: string; quantity: string }[];
    steps: string[];
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    declared_allergens: string[];
  } | null;
  guide: CookStep[];
  gaps: IngredientGap[];
  shopping_at: string | null;
  rebuild_week: boolean;
}

export interface ChefApplyResult {
  slot_id: string | null;
  title: string | null;
  starts_at: string;
  ends_at: string;
  calendar_event_id: string | null;
  shopping_items: string[];
  shopping_at: string | null;
  rebuild_week: boolean;
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
  now: string;
  windows: { start: string; end: string; minutes: number; meal: "lunch" | "dinner" }[];
}): Promise<{ message: string; proposal: ChefProposal | null }> {
  const res = await fetch(`${API_URL}/recipes/chef`, {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return check(res);
}

export async function applyChefProposal(proposal: ChefProposal): Promise<ChefApplyResult> {
  const res = await fetch(`${API_URL}/recipes/chef/apply`, {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify({ proposal }),
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
