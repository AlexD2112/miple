import { timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { env } from "../env.js";
import { db } from "../lib/supabase.js";
import { parseInbound, sendText } from "../lib/photon.js";

export const photon = Router();

/** Inbound SMS / iMessage replies: "done" cooks the nudged meal, "skip" skips it. */
photon.post("/webhook", async (req, res) => {
  if (!validSecret(req.header("x-photon-secret"))) return res.status(401).end();

  const msg = parseInbound(req.body);
  if (!msg) return res.status(400).json({ error: "unrecognized payload" });

  const { data: profile } = await db.from("profiles").select("id").eq("phone", msg.from).maybeSingle();
  if (!profile) return res.status(200).json({ ok: true, ignored: "unknown number" });

  const { data: slot } = await db
    .from("meal_slots")
    .select("id, recipes(title)")
    .eq("user_id", profile.id)
    .eq("status", "planned")
    .not("nudged_at", "is", null)
    .order("nudged_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const reply = msg.text.trim().toLowerCase();
  const title = (slot?.recipes as unknown as { title: string } | null)?.title ?? "your meal";

  if (!slot) {
    await sendText(msg.from, "Nothing planned right now. Open Miple to plan your next meal.");
  } else if (/^(done|cooked|yes|y)\b/.test(reply)) {
    const { error } = await db.rpc("cook_meal_slot", { p_slot_id: slot.id });
    if (error) throw error;
    // Logging to Apple Health happens on the phone: the app syncs slots with logged_to_health=false.
    await sendText(msg.from, `Nice! Logged ${title}. Leftovers are in your pantry for the next 4 days.`);
  } else if (/^(skip|no|n)\b/.test(reply)) {
    await db.from("meal_slots").update({ status: "skipped" }).eq("id", slot.id);
    await sendText(msg.from, `Skipped ${title}. Miple will re-plan around what's expiring.`);
  } else {
    await sendText(msg.from, `Reply DONE once you've cooked ${title}, or SKIP.`);
  }

  res.json({ ok: true });
});

function validSecret(given: string | undefined): boolean {
  if (!env.photonWebhookSecret) return true; // local dev only; set PHOTON_WEBHOOK_SECRET in prod
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(env.photonWebhookSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}
