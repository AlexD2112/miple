import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { Button, Card, Chip, Field, Pill, ProgressBar, ProgressRing, Row, Screen, Title, colors, styles } from "@/components/ui";
import { addDaysIso, localIsoDate } from "@/lib/dates";
import {
  addEntries,
  asNew,
  deleteEntry,
  entryTotals,
  foodLogMissing,
  loadDay,
  sumTotals,
  updateEntry,
  weekAverages,
  type CookedSlot,
} from "@/lib/foodLog";
import { logEntriesToHealth, removeFromHealth } from "@/lib/health";
import { useProfile } from "@/lib/profile";
import { MEALS, type FoodLogEntry, type MealName } from "@/lib/types";
import { useFocusData } from "@/lib/useFocusData";

const FIBER_GOAL_G = 30;

const MEAL_LABEL: Record<MealName, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snacks" };

function dayLabel(day: string): string {
  const today = localIsoDate();
  if (day === today) return "Today";
  if (day === addDaysIso(today, -1)) return "Yesterday";
  if (day === addDaysIso(today, 1)) return "Tomorrow";
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

const fmt = (n: number) => String(Math.round(n));

/** MacroFactor-style food diary: one day's food by meal, with totals against today's targets. */
export default function Log() {
  const { profile } = useProfile();
  const [day, setDay] = useState(localIsoDate());
  const [open, setOpen] = useState<string | null>(null);

  const [data, reload, loading] = useFocusData(async () => {
    const [d, week] = await Promise.all([loadDay(day), weekAverages().catch(() => null)]);
    return { ...d, week };
  }, [day]);

  const entries = data?.entries ?? [];
  const cooked = data?.cooked ?? [];
  const totals = sumTotals([...entries.map(entryTotals), ...cooked.map((c) => c.totals)]);
  const target = {
    calories: profile?.calorie_target ?? 2000,
    protein_g: profile?.protein_target_g ?? 120,
    carbs_g: profile?.carbs_target_g ?? 220,
    fat_g: profile?.fat_target_g ?? 65,
  };
  const left = Math.round(target.calories - totals.calories);

  async function copyYesterday() {
    const prev = await loadDay(addDaysIso(day, -1));
    if (!prev.entries.length) return Alert.alert("Nothing to copy", `${dayLabel(addDaysIso(day, -1))} has no food logged.`);
    const { data: saved, error } = await addEntries(prev.entries.map((e) => asNew(e, day, e.meal)));
    if (error) return Alert.alert("Couldn't copy", error);
    await logEntriesToHealth(profile, saved);
    reload();
  }

  const add = (meal: MealName) => router.push({ pathname: "/log-food", params: { meal, day } });

  return (
    <Screen>
      <Title sub={loading && !data ? "Loading…" : `${fmt(totals.calories)} of ${fmt(target.calories)} kcal`}>Log</Title>

      <Row style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <Pressable onPress={() => setDay(addDaysIso(day, -1))} hitSlop={12} accessibilityLabel="Previous day">
          <Text style={{ color: colors.brand, fontSize: 22, fontWeight: "700", paddingHorizontal: 8 }}>‹</Text>
        </Pressable>
        <Pressable onPress={() => setDay(localIsoDate())}>
          <Text style={[styles.body, { fontWeight: "700" }]}>{dayLabel(day)}</Text>
        </Pressable>
        <Pressable onPress={() => setDay(addDaysIso(day, 1))} hitSlop={12} accessibilityLabel="Next day">
          <Text style={{ color: colors.brand, fontSize: 22, fontWeight: "700", paddingHorizontal: 8 }}>›</Text>
        </Pressable>
      </Row>

      {foodLogMissing ? (
        <Card style={{ backgroundColor: colors.warnSoft }}>
          <Text style={styles.body}>{"The food log isn't set up on the server yet."}</Text>
          <Text style={styles.muted}>Whoever runs the Supabase project needs to run migration 0005_food_log.sql.</Text>
        </Card>
      ) : null}

      <Card>
        <Row style={{ alignItems: "center", gap: 16 }}>
          <ProgressRing progress={target.calories > 0 ? totals.calories / target.calories : 0} size={112} stroke={10}>
            <Text style={{ fontSize: 24, fontWeight: "700", color: left < 0 ? colors.danger : colors.text, fontVariant: ["tabular-nums"] }}>
              {fmt(Math.abs(left))}
            </Text>
            <Text style={[styles.muted, { fontSize: 12 }]}>{left < 0 ? "kcal over" : "kcal left"}</Text>
          </ProgressRing>
          <View style={{ flex: 1, gap: 8 }}>
            <MacroBar label="Protein" value={totals.protein_g} goal={target.protein_g} color={colors.danger} />
            <MacroBar label="Carbs" value={totals.carbs_g} goal={target.carbs_g} color={colors.warn} />
            <MacroBar label="Fat" value={totals.fat_g} goal={target.fat_g} color="#FFCC00" />
            <MacroBar label="Fiber" value={totals.fiber_g} goal={FIBER_GOAL_G} color={colors.brand} />
          </View>
        </Row>
      </Card>

      {MEALS.map((meal) => {
        const list = entries.filter((e) => e.meal === meal);
        const fromPlan = cooked.filter((c) => mealOf(c) === meal);
        const kcal = sumTotals([...list.map(entryTotals), ...fromPlan.map((c) => c.totals)]).calories;
        return (
          <Card key={meal}>
            <Row style={{ justifyContent: "space-between", alignItems: "center", marginBottom: list.length || fromPlan.length ? 8 : 0 }}>
              <Text style={styles.h2}>
                {MEAL_LABEL[meal]}
                {kcal > 0 ? <Text style={styles.muted}>{`  ${fmt(kcal)} kcal`}</Text> : null}
              </Text>
              <Pressable onPress={() => add(meal)} hitSlop={10} accessibilityLabel={`Add to ${MEAL_LABEL[meal]}`}>
                <Text style={{ color: colors.brand, fontWeight: "700", fontSize: 17 }}>+ Add</Text>
              </Pressable>
            </Row>
            {list.map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                open={open === e.id}
                onToggle={() => setOpen(open === e.id ? null : e.id)}
                onChanged={() => {
                  setOpen(null);
                  reload();
                }}
              />
            ))}
            {fromPlan.map((c) => (
              <View key={c.id} style={{ paddingVertical: 6 }}>
                <Row style={{ justifyContent: "space-between" }}>
                  <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
                    {c.title}
                  </Text>
                  <Text style={styles.body}>{fmt(c.totals.calories)}</Text>
                </Row>
                <Text style={styles.muted}>Cooked from your plan</Text>
              </View>
            ))}
          </Card>
        );
      })}

      {entries.length === 0 && cooked.length === 0 && data ? (
        <Button kind="secondary" label={`Copy ${dayLabel(addDaysIso(day, -1)).toLowerCase()}'s food`} onPress={copyYesterday} />
      ) : null}

      {data?.week ? (
        <Card style={{ marginTop: 12 }}>
          <Text style={styles.h2}>Last 7 days</Text>
          <Text style={styles.body}>
            {data.week.calories} kcal and {data.week.protein_g} g protein a day
          </Text>
          <Text style={styles.muted}>
            Averaged over {data.week.days} logged day{data.week.days === 1 ? "" : "s"}. Ripe uses your log and weigh-ins to measure
            your expenditure on the Me tab.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}

function mealOf(c: CookedSlot): MealName {
  const h = new Date(c.cooked_at).getHours();
  return h < 11 ? "breakfast" : h < 16 ? "lunch" : "dinner";
}

function MacroBar({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  return (
    <View>
      <Row style={{ justifyContent: "space-between" }}>
        <Text style={[styles.muted, { fontSize: 13 }]}>{label}</Text>
        <Text style={[styles.muted, { fontSize: 13 }]}>
          {fmt(value)} / {fmt(goal)} g
        </Text>
      </Row>
      <ProgressBar progress={goal > 0 ? value / goal : 0} color={color} />
    </View>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  photo: "photo",
  label: "label",
  describe: "described",
  barcode: "barcode",
  search: "USDA",
  quick: "quick add",
  recipe: "Ripe recipe",
  copy: "copied",
};

function EntryRow({ entry, open, onToggle, onChanged }: { entry: FoodLogEntry; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const { profile } = useProfile();
  const [servings, setServings] = useState(String(entry.servings));
  const [meal, setMeal] = useState<MealName>(entry.meal);
  const [busy, setBusy] = useState(false);
  const t = entryTotals(entry);

  async function save() {
    const s = parseFloat(servings);
    if (!(s > 0)) return Alert.alert("Enter how many servings");
    setBusy(true);
    // Apple Health samples can't be edited, so an edited entry is removed there and written again.
    if (entry.logged_to_health) await removeFromHealth(entry.id);
    const error = await updateEntry(entry.id, { servings: s, meal, logged_to_health: false });
    if (!error) await logEntriesToHealth(profile, [{ ...entry, servings: s, meal, logged_to_health: false }]);
    setBusy(false);
    if (error) return Alert.alert("Couldn't save", error);
    onChanged();
  }

  async function remove() {
    setBusy(true);
    if (entry.logged_to_health) await removeFromHealth(entry.id);
    const error = await deleteEntry(entry.id);
    setBusy(false);
    if (error) return Alert.alert("Couldn't delete", error);
    onChanged();
  }

  return (
    <View style={{ paddingVertical: 6, borderTopWidth: 0.5, borderTopColor: colors.border }}>
      <Pressable onPress={onToggle}>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={[styles.body, { flex: 1, marginRight: 8 }]} numberOfLines={1}>
            {entry.name}
          </Text>
          <Text style={styles.body}>{fmt(t.calories)}</Text>
        </Row>
        <Text style={styles.muted} numberOfLines={1}>
          {Number(entry.servings) === 1 ? "" : `${entry.servings} × `}
          {entry.serving_desc ?? "serving"} · P {fmt(t.protein_g)} · C {fmt(t.carbs_g)} · F {fmt(t.fat_g)}
        </Text>
      </Pressable>
      {open ? (
        <View style={{ marginTop: 8 }}>
          <Row style={{ gap: 8, alignItems: "flex-end" }}>
            <View style={{ width: 110 }}>
              <Field label="Servings" keyboardType="decimal-pad" value={servings} onChangeText={setServings} />
            </View>
            <View style={{ flex: 1, paddingBottom: 12 }}>
              {entry.brand ? <Text style={styles.muted}>{entry.brand}</Text> : null}
              <Pill label={SOURCE_LABEL[entry.source] ?? entry.source} />
            </View>
          </Row>
          <Row style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {MEALS.map((m) => (
              <Chip key={m} label={MEAL_LABEL[m]} selected={meal === m} onPress={() => setMeal(m)} />
            ))}
          </Row>
          <Row style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button small label="Save" onPress={save} loading={busy} />
            </View>
            <View style={{ flex: 1 }}>
              <Button small kind="danger" label="Delete" onPress={remove} disabled={busy} />
            </View>
          </Row>
        </View>
      ) : null}
    </View>
  );
}
