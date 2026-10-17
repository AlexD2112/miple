import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Button, Card, Pill, Row, Screen, Title, styles } from "@/components/ui";
import { generateRecipes } from "@/lib/api";
import { addMealToCalendar, findFreeMealWindows } from "@/lib/calendar";
import { daysUntil, timeRange } from "@/lib/dates";
import { getRemainingMacros, logMealToHealth, type MacroStatus } from "@/lib/health";
import { assignRecipes } from "@/lib/planner";
import { useProfile } from "@/lib/profile";
import { currentUserId, supabase } from "@/lib/supabase";
import type { Item, MealSlot } from "@/lib/types";
import { useFocusData } from "@/lib/useFocusData";

const PLAN_DAYS = 3;

export default function Plan() {
  const { profile } = useProfile();
  const [planning, setPlanning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const [data, reload] = useFocusData(async () => {
    if (!profile) return null;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const [macros, slots] = await Promise.all([
      getRemainingMacros(profile),
      supabase
        .from("meal_slots")
        .select("*, recipes(*)")
        .gte("starts_at", since.toISOString())
        .neq("status", "skipped")
        .order("starts_at"),
    ]);
    return { macros, slots: (slots.data ?? []) as MealSlot[] };
  }, [profile]);

  async function planMeals() {
    if (!profile || !data) return;
    setPlanning(true);
    try {
      const { data: items } = await supabase.from("items").select("*").eq("status", "active");
      const pantry = (items ?? []) as Item[];
      if (pantry.length === 0) throw new Error("Your pantry is empty. Scan a receipt first.");

      // Skip windows that already have a meal planned.
      const taken = data.slots.filter((s) => s.status === "planned").map((s) => new Date(s.starts_at).getTime());
      const windows = (await findFreeMealWindows(PLAN_DAYS)).filter(
        (w) => !taken.some((t) => Math.abs(t - w.start.getTime()) < 3 * 60 * 60 * 1000),
      );
      if (windows.length === 0) throw new Error("No free meal windows in the next 3 days.");

      const { recipes, rejected } = await generateRecipes({
        pantry: pantry.map((i) => ({
          id: i.id,
          name: i.name,
          category: i.category,
          quantity: Number(i.quantity),
          unit: i.unit,
          days_left: daysUntil(i.estimated_expiry),
        })),
        remaining: data.macros.remaining,
        max_minutes: Math.max(...windows.map((w) => w.minutes)),
        count: Math.min(8, windows.length + 2),
      });
      if (rejected) console.log(`[plan] ${rejected} recipes dropped by allergen/dislike/time filters`);

      const plan = assignRecipes(windows, recipes, pantry, data.macros.remaining, data.macros.target);
      if (plan.length === 0) throw new Error("Couldn't fit any recipes into your free time.");

      const user_id = await currentUserId();
      const { error } = await supabase.from("meal_slots").insert(
        plan.map((p) => ({
          user_id,
          starts_at: p.window.start.toISOString(),
          ends_at: p.window.end.toISOString(),
          recipe_id: p.recipe.id,
        })),
      );
      if (error) throw error;
      reload();
    } catch (err) {
      Alert.alert("Planning failed", err instanceof Error ? err.message : String(err));
    } finally {
      setPlanning(false);
    }
  }

  async function addToCalendar(slot: MealSlot) {
    if (!slot.recipes) return;
    const notes = [
      `${slot.recipes.minutes} min · ${slot.recipes.calories} kcal · ${slot.recipes.protein_g}g protein`,
      "",
      ...slot.recipes.ingredients.map((i) => `• ${i.quantity} ${i.name}`),
      "",
      ...slot.recipes.steps.map((s, n) => `${n + 1}. ${s}`),
    ].join("\n");
    const eventId = await addMealToCalendar(slot.recipes.title, new Date(slot.starts_at), new Date(slot.ends_at), notes);
    if (!eventId) return Alert.alert("Calendar access is needed to add events.");
    await supabase.from("meal_slots").update({ calendar_event_id: eventId }).eq("id", slot.id);
    reload();
  }

  async function markCooked(slot: MealSlot) {
    const { error } = await supabase.rpc("cook_meal_slot", { p_slot_id: slot.id });
    if (error) return Alert.alert("Couldn't mark cooked", error.message);
    if (profile?.healthkit_enabled && slot.recipes && (await logMealToHealth(slot.recipes))) {
      await supabase.from("meal_slots").update({ logged_to_health: true }).eq("id", slot.id);
    }
    reload();
  }

  async function skip(slot: MealSlot) {
    await supabase.from("meal_slots").update({ status: "skipped" }).eq("id", slot.id);
    reload();
  }

  return (
    <Screen>
      <Title sub={`Next ${PLAN_DAYS} days, fitted to your calendar and macros`}>Plan</Title>
      {data?.macros ? <MacroSummary m={data.macros} /> : null}
      <Button label="Plan my meals" onPress={planMeals} loading={planning} disabled={!profile} />
      <View style={{ height: 12 }} />

      {(data?.slots ?? []).map((slot) => {
        const r = slot.recipes;
        const open = expanded === slot.id;
        return (
          <Card key={slot.id}>
            <Row style={{ justifyContent: "space-between" }}>
              <Text style={styles.muted}>{timeRange(slot.starts_at, slot.ends_at)}</Text>
              {slot.status === "cooked" ? (
                <Pill label={slot.logged_to_health ? "cooked · in Health" : "cooked"} tone="good" />
              ) : slot.calendar_event_id ? (
                <Pill label="on calendar" />
              ) : null}
            </Row>
            <Text style={[styles.h2, { marginTop: 4 }]} onPress={() => setExpanded(open ? null : slot.id)}>
              {r?.title ?? "Recipe removed"}
            </Text>
            {r ? (
              <Text style={styles.muted}>
                {r.minutes} min · {r.calories} kcal · P {r.protein_g}g · C {r.carbs_g}g · F {r.fat_g}g
              </Text>
            ) : null}
            {open && r ? (
              <View style={{ marginTop: 8 }}>
                {r.ingredients.map((i, n) => (
                  <Text key={n} style={styles.body}>
                    • {i.quantity} {i.name}
                    {i.item_id ? " 🥬" : ""}
                  </Text>
                ))}
                <View style={{ height: 6 }} />
                {r.steps.map((s, n) => (
                  <Text key={n} style={[styles.body, { marginBottom: 4 }]}>
                    {n + 1}. {s}
                  </Text>
                ))}
              </View>
            ) : null}
            {slot.status === "planned" ? (
              <Row style={{ marginTop: 10 }}>
                {!slot.calendar_event_id ? <Button small kind="secondary" label="Add to calendar" onPress={() => addToCalendar(slot)} /> : null}
                <View style={{ flex: 1 }} />
                <Button small kind="secondary" label="Skip" onPress={() => skip(slot)} />
                <Button small label="Cooked" onPress={() => markCooked(slot)} />
              </Row>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}

function MacroSummary({ m }: { m: MacroStatus }) {
  return (
    <Card>
      <Row style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <Text style={styles.h2}>Today</Text>
        <Pill label={m.source === "healthkit" ? "Apple Health" : "Manual targets"} tone={m.source === "healthkit" ? "good" : "neutral"} />
      </Row>
      <Text style={styles.body}>
        You've had {Math.round(m.consumed.calories)} kcal and {Math.round(m.consumed.protein_g)}g protein
        {m.activeEnergyBurned > 0 ? `, and burned ${Math.round(m.activeEnergyBurned)} kcal` : ""}.
      </Text>
      <Text style={[styles.muted, { marginTop: 4 }]}>
        Remaining: {m.remaining.calories} kcal · P {m.remaining.protein_g}g · C {m.remaining.carbs_g}g · F {m.remaining.fat_g}g
      </Text>
    </Card>
  );
}
