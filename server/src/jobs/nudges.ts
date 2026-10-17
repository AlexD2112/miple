import { db, type Profile } from "../lib/supabase.js";
import { sendText } from "../lib/photon.js";

const HOUR = 60 * 60 * 1000;

interface ExpiringItem {
  id: string;
  name: string;
  estimated_expiry: string;
}

interface PlannedSlot {
  id: string;
  starts_at: string;
  ends_at: string;
  recipes: { title: string; minutes: number; ingredients: { item_id: string | null }[] } | null;
}

/** Daily: mark expired items wasted, then text everyone with food expiring in the next 48h. */
export async function runDailyNudges(now = new Date()): Promise<{ wasted: number; sent: number }> {
  const { data: wasted } = await db.rpc("mark_expired_wasted");

  const { data: profiles, error } = await db
    .from("profiles")
    .select("*")
    .eq("nudges_enabled", true)
    .not("phone", "is", null);
  if (error) throw error;

  let sent = 0;
  for (const profile of profiles as Profile[]) {
    try {
      if (await nudgeUser(profile, now)) sent++;
    } catch (err) {
      console.error(`[nudges] failed for ${profile.id}`, err);
    }
  }
  return { wasted: (wasted as number) ?? 0, sent };
}

async function nudgeUser(profile: Profile, now: Date): Promise<boolean> {
  const horizon = new Date(now.getTime() + 48 * HOUR);

  const { data: items } = await db
    .from("items")
    .select("id, name, estimated_expiry")
    .eq("user_id", profile.id)
    .eq("status", "active")
    .lte("estimated_expiry", horizon.toISOString().slice(0, 10))
    .order("estimated_expiry");
  const expiring = (items ?? []) as ExpiringItem[];
  if (expiring.length === 0) return false;

  const { data: slots } = await db
    .from("meal_slots")
    .select("id, starts_at, ends_at, recipes(title, minutes, ingredients)")
    .eq("user_id", profile.id)
    .eq("status", "planned")
    .is("nudged_at", null)
    .gte("starts_at", now.toISOString())
    .lte("starts_at", horizon.toISOString())
    .order("starts_at");
  const planned = (slots ?? []) as unknown as PlannedSlot[];

  // Prefer the first slot whose recipe actually uses an expiring item.
  const expiringIds = new Set(expiring.map((i) => i.id));
  const slot =
    planned.find((s) => s.recipes?.ingredients.some((i) => i.item_id && expiringIds.has(i.item_id))) ??
    planned[0];

  const lead = expiring[0];
  const when = relativeDay(lead.estimated_expiry, now, profile.timezone);
  const others = expiring.length > 1 ? ` (+${expiring.length - 1} more)` : "";

  const text = slot?.recipes
    ? `${capitalize(lead.name)} expires ${when}${others}. You're free ${timeRange(slot, profile.timezone)}. ` +
      `${slot.recipes.minutes}-min ${slot.recipes.title}? Reply DONE when cooked or SKIP.`
    : `${capitalize(lead.name)} expires ${when}${others}. Open Miple to plan a meal around it.`;

  await sendText(profile.phone!, text);
  if (slot) await db.from("meal_slots").update({ nudged_at: now.toISOString() }).eq("id", slot.id);
  return true;
}

function relativeDay(isoDate: string, now: Date, timeZone: string): string {
  const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  const diff = Math.round((Date.parse(isoDate) - Date.parse(todayLocal)) / (24 * HOUR));
  if (diff <= 0) return "today";
  if (diff === 1) return "tomorrow";
  return `in ${diff} days`;
}

function timeRange(slot: PlannedSlot, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" });
  const start = new Date(slot.starts_at);
  return `${day.format(start)} ${fmt.format(start)}–${fmt.format(new Date(slot.ends_at))}`;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
