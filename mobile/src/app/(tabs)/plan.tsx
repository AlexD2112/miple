import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { Button, Card, Pill, ProgressBar, ProgressRing, Row, Screen, Title, colors, styles } from "@/components/ui";
import { addMealToCalendar } from "@/lib/calendar";
import { timeRange } from "@/lib/dates";
import { getRemainingMacros, logMealToHealth, type MacroStatus } from "@/lib/health";
import { useProfile } from "@/lib/profile";
import { MAX_PLAN_DAYS, MAX_PLAN_MEALS, MEALS_PER_PLAN, mealNotes, planDays, planMealCount, planOpenWindows, syncMealsToCalendar } from "@/lib/schedule";
import { supabase } from "@/lib/supabase";
import type { MealSlot } from "@/lib/types";
import { stepText } from "@/lib/types";
import { useFocusData } from "@/lib/useFocusData";

export default function Plan() {
  const { profile } = useProfile();
  const [planning, setPlanning] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [daysText, setDaysText] = useState("7");
  const days = planDays(parseInt(daysText, 10));
  const [mealsText, setMealsText] = useState(String(MEALS_PER_PLAN));
  const meals = planMealCount(parseInt(mealsText, 10));

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
    const planned = (slots.data ?? []) as MealSlot[];
    await syncMealsToCalendar(planned);
    return { macros, slots: planned };
  }, [profile]);

  async function planMeals() {
    if (!profile || !data) return;
    setPlanning(true);
    try {
      const count = await planOpenWindows({ remaining: data.macros.remaining, target: data.macros.target, days, meals });
      if (count === 0) throw new Error(`No free meal windows in the next ${days} days, or nothing fit.`);
      reload();
    } catch (err) {
      Alert.alert("Planning failed", err instanceof Error ? err.message : String(err));
    } finally {
      setPlanning(false);
    }
  }

  async function addToCalendar(slot: MealSlot) {
    if (!slot.recipes) return;
    const eventId = await addMealToCalendar(
      slot.recipes.title,
      new Date(slot.starts_at),
      new Date(slot.ends_at),
      mealNotes(slot.recipes),
      slot.calendar_event_id,
    );
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
      <Title sub={`Up to ${meals} meal${meals === 1 ? "" : "s"}, placed in the next ${days} day${days === 1 ? "" : "s"}`}>Plan</Title>
      {data?.macros ? <MacroSummary m={data.macros} /> : null}
      <Card>
        <Stepper
          title="How many meals"
          sub={`Lunches and dinners to plan, up to ${MAX_PLAN_MEALS}`}
          label="Meals"
          text={mealsText}
          setText={setMealsText}
          value={meals}
          clamp={(n) => planMealCount(n)}
        />
        <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 12 }} />
        <Stepper
          title="How far ahead"
          sub={`Open lunches and dinners, up to ${MAX_PLAN_DAYS} days`}
          label="Days ahead"
          text={daysText}
          setText={setDaysText}
          value={days}
          clamp={(n) => planDays(n)}
        />
      </Card>
      <Button label={`Plan ${meals} meal${meals === 1 ? "" : "s"}`} onPress={planMeals} loading={planning} disabled={!profile} />
      <View style={{ height: 8 }} />
      <Button
        kind="secondary"
        label="Chat with your chef"
        onPress={() => router.push({ pathname: "/chef", params: { days: String(days) } })}
        disabled={!profile}
      />
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
                    {n + 1}. {stepText(s)}
                  </Text>
                ))}
              </View>
            ) : null}
            {slot.status === "planned" ? (
              <Row style={{ marginTop: 10 }}>
                {!slot.calendar_event_id ? <Button small kind="secondary" label="Add to calendar" onPress={() => addToCalendar(slot)} /> : null}
                <View style={{ flex: 1 }} />
                <Button small kind="secondary" label="Follow" onPress={() => router.push({ pathname: "/cook", params: { slot: slot.id } })} />
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

const FIBER_GOAL_G = 30;

function MacroSummary({ m }: { m: MacroStatus }) {
  const calorieTarget = m.target.calories;
  const rows = [
    { label: "Protein", consumed: m.consumed.protein_g, goal: m.target.protein_g, color: colors.danger },
    { label: "Carbs", consumed: m.consumed.carbs_g, goal: m.target.carbs_g, color: colors.warn },
    { label: "Fat", consumed: m.consumed.fat_g, goal: m.target.fat_g, color: "#FFCC00" },
    ...(m.fiber_g === undefined ? [] : [{ label: "Fiber", consumed: m.fiber_g, goal: FIBER_GOAL_G, color: colors.brand }]),
  ];

  return (
    <Card>
      <Row style={{ justifyContent: "space-between", marginBottom: 16 }}>
        <Text style={styles.h2}>Today</Text>
        <Pill label={m.source === "healthkit" ? "Apple Health" : "Manual targets"} tone={m.source === "healthkit" ? "good" : "neutral"} />
      </Row>
      <View style={{ alignItems: "center", marginBottom: 20 }}>
        <ProgressRing progress={calorieTarget > 0 ? m.consumed.calories / calorieTarget : 0} size={168} stroke={12} color={colors.brand}>
          <Text style={{ fontSize: 32, lineHeight: 36, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] }}>
            {Math.round(m.consumed.calories)}
          </Text>
        </ProgressRing>
        <Text style={[styles.muted, { marginTop: 10 }]}>of {Math.round(calorieTarget)} kcal</Text>
      </View>
      {rows.map((row) => (
        <View key={row.label} style={{ marginBottom: 12 }}>
          <Row style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={styles.body}>{row.label}</Text>
            <Text style={styles.muted}>
              {Math.round(row.consumed)} / {Math.round(row.goal)} g
            </Text>
          </Row>
          <ProgressBar progress={row.goal > 0 ? row.consumed / row.goal : 0} color={row.color} />
        </View>
      ))}
      {m.activeEnergyBurned > 0 ? (
        <Text style={[styles.muted, { marginTop: 4 }]}>+{Math.round(m.activeEnergyBurned)} kcal burned</Text>
      ) : null}
    </Card>
  );
}

/** "−  10  +" row: tap to step, or type a number. */
function Stepper(props: {
  title: string;
  sub: string;
  label: string;
  text: string;
  setText: (t: string) => void;
  value: number;
  clamp: (n: number) => number;
}) {
  const { title, sub, label, text, setText, value, clamp } = props;
  return (
    <Row style={{ alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ flex: 1, marginRight: 12 }}>
        <Text style={styles.h2}>{title}</Text>
        <Text style={styles.muted}>{sub}</Text>
      </View>
      <Row style={{ alignItems: "center" }}>
        <Pressable accessibilityLabel={`Fewer ${label.toLowerCase()}`} onPress={() => setText(String(clamp(value - 1)))} style={{ paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ color: colors.brand, fontSize: 28, fontWeight: "600" }}>−</Text>
        </Pressable>
        <TextInput
          accessibilityLabel={label}
          keyboardType="number-pad"
          value={text}
          onChangeText={(t) => setText(t.replace(/[^0-9]/g, "").slice(0, 2))}
          onBlur={() => setText(String(value))}
          style={{ width: 44, textAlign: "center", fontSize: 20, fontWeight: "700", color: colors.text }}
        />
        <Pressable accessibilityLabel={`More ${label.toLowerCase()}`} onPress={() => setText(String(clamp(value + 1)))} style={{ paddingHorizontal: 10, paddingVertical: 4 }}>
          <Text style={{ color: colors.brand, fontSize: 28, fontWeight: "600" }}>+</Text>
        </Pressable>
      </Row>
    </Row>
  );
}
