import { db } from "../lib/supabase.js";

/** Marks active pantry items past their expiry date as wasted, which feeds the weekly Wrapped totals. */
export async function markExpiredWasted(): Promise<number> {
  const { data, error } = await db.rpc("mark_expired_wasted");
  if (error) throw error;
  return (data as number | null) ?? 0;
}
