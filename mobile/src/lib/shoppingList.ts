import { currentUserId, supabase } from "./supabase";
import { CATEGORIES, type ShoppingListItem } from "./types";

/** The shopping list (public.shopping_list): typed in, scanned from a photo, or added from suggestions. */

export async function loadList(): Promise<{ items: ShoppingListItem[]; error: string | null }> {
  const { data, error } = await supabase
    .from("shopping_list")
    .select("*")
    .order("checked", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) console.warn("[shopping list]", error.message);
  return { items: (data ?? []) as ShoppingListItem[], error: error ? error.message : null };
}

/** Adds items, skipping ones already unchecked on the list (same name, any case). */
export async function addToList(
  items: { name: string; quantity?: string | null; category?: string }[],
  source: ShoppingListItem["source"] = "manual",
): Promise<{ added: number; error: string | null }> {
  const { items: current } = await loadList();
  const have = new Set(current.filter((i) => !i.checked).map((i) => i.name.toLowerCase()));
  const user_id = await currentUserId();
  const rows = [];
  for (const i of items) {
    const name = i.name.trim().slice(0, 80);
    if (!name || have.has(name.toLowerCase())) continue;
    have.add(name.toLowerCase());
    rows.push({
      user_id,
      name,
      quantity: i.quantity?.trim() || null,
      category: (CATEGORIES as readonly string[]).includes(i.category ?? "") ? i.category : "other",
      source,
    });
  }
  if (!rows.length) return { added: 0, error: null };
  const { error } = await supabase.from("shopping_list").insert(rows);
  return { added: error ? 0 : rows.length, error: error?.message ?? null };
}

export async function setChecked(id: string, checked: boolean) {
  await supabase.from("shopping_list").update({ checked }).eq("id", id);
}

export async function removeFromList(ids: string[]) {
  if (ids.length) await supabase.from("shopping_list").delete().in("id", ids);
}

/** Plain-text list for sharing or pasting into notes. */
export function listText(items: ShoppingListItem[]): string {
  return items
    .filter((i) => !i.checked)
    .map((i) => `• ${i.name}${i.quantity ? ` (${i.quantity})` : ""}`)
    .join("\n");
}
