import { Platform } from "react-native";
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
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : body.error ? JSON.stringify(body.error) : `HTTP ${res.status}`);
  return body as T;
}

export async function parseReceipt(imageUri: string, mimeType = "image/jpeg"): Promise<ParsedReceipt> {
  const form = new FormData();
  await appendImage(form, imageUri, mimeType);
  return postForm<ParsedReceipt>(`${API_URL}/receipts/parse`, form, await authHeader());
}

async function appendImage(form: FormData, imageUri: string, mimeType: string) {
  if (Platform.OS === "web") {
    // The picker hands the browser a blob: or data: URL; the real file is behind it.
    const blob = await (await fetch(imageUri)).blob();
    form.append("image", blob, "photo.jpg");
    return;
  }
  // Global fetch is Expo's WinterCG fetch. It only accepts string, Blob, or bytes()
  // parts, and throws "Unsupported FormDataPart implementation" for this descriptor.
  // XMLHttpRequest still hands { uri, name, type } to native networking, which reads the file.
  form.append("image", { uri: imageUri, name: "photo.jpg", type: mimeType } as unknown as Blob);
}

export interface EstimatedFood {
  name: string;
  portion: string;
  grams: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
  confidence: number;
}

export interface FoodEstimate {
  kind: "meal" | "label" | "not_food";
  title: string;
  items: EstimatedFood[];
}

/** Calories and macros for a meal photo, a nutrition label photo, or a typed description. Saves nothing. */
export async function estimateFood(input: { imageUri?: string; mimeType?: string; text?: string }): Promise<FoodEstimate> {
  if (!input.imageUri) {
    const res = await fetch(`${API_URL}/food/estimate`, {
      method: "POST",
      headers: { ...(await authHeader()), "Content-Type": "application/json" },
      body: JSON.stringify({ text: input.text ?? "" }),
    });
    return check(res);
  }
  const form = new FormData();
  await appendImage(form, input.imageUri, input.mimeType ?? "image/jpeg");
  if (input.text?.trim()) form.append("text", input.text.trim());
  return postForm<FoodEstimate>(`${API_URL}/food/estimate`, form, await authHeader());
}

export interface NutritionPer {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number | null;
}

export interface BarcodeFood {
  barcode: string;
  name: string;
  brand: string | null;
  serving_desc: string | null;
  serving_g: number | null;
  per_serving: NutritionPer | null;
  per_100g: NutritionPer | null;
}

/** Product nutrition from Open Food Facts, by UPC/EAN. Throws with a readable message when not found. */
export async function lookupBarcode(code: string): Promise<BarcodeFood> {
  const res = await fetch(`${API_URL}/food/barcode/${encodeURIComponent(code)}`, { headers: await authHeader() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${res.status}`);
  return body as BarcodeFood;
}

export interface FoodSearchHit {
  fdc_id: number;
  name: string;
  description: string;
  confidence: number;
  calories_kcal_100g: number | null;
  protein_g_100g: number | null;
  carbs_g_100g: number | null;
  fat_g_100g: number | null;
  fiber_g_100g: number | null;
}

/** USDA foods matching a search, per 100 g as sold. */
export async function searchFoods(q: string): Promise<FoodSearchHit[]> {
  const res = await fetch(`${API_URL}/food/search?q=${encodeURIComponent(q)}`, { headers: await authHeader() });
  return (await check<{ results: FoodSearchHit[] }>(res)).results;
}

export interface ScannedListItem {
  name: string;
  quantity: string | null;
  category: string;
}

/** Items from a photo of a handwritten or printed shopping list. */
export async function scanShoppingList(imageUri: string, mimeType = "image/jpeg"): Promise<ScannedListItem[]> {
  const form = new FormData();
  await appendImage(form, imageUri, mimeType);
  return (await postForm<{ items: ScannedListItem[] }>(`${API_URL}/shopping/scan-list`, form, await authHeader())).items;
}

function postForm<T>(url: string, form: FormData, headers: Record<string, string>): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);
    xhr.onload = () => {
      let body: { error?: unknown } = {};
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        body = {};
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const error =
          typeof body.error === "string" ? body.error : body.error ? JSON.stringify(body.error) : `HTTP ${xhr.status}`;
        reject(new Error(error));
        return;
      }
      resolve(body as T);
    };
    xhr.timeout = 90_000;
    xhr.onerror = () => reject(new Error("Couldn't reach Ripe. Check your connection and try again."));
    xhr.ontimeout = () => reject(new Error("Ripe took too long to answer. Check your connection and try again."));
    xhr.send(form);
  });
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

export interface CategoryGuess {
  category: string;
  source: "matcher" | "llm" | "default";
  confidence: number;
}

/** Pantry category for a manually added item (USDA matcher, then LLM). */
export async function guessCategory(name: string): Promise<CategoryGuess> {
  const res = await fetch(`${API_URL}/items/category`, {
    method: "POST",
    headers: { ...(await authHeader()), "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return check(res);
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
