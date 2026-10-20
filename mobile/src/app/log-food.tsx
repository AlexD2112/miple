import * as ImagePicker from "expo-image-picker";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Platform, Pressable, Text, TextInput, View } from "react-native";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { Button, Card, Chip, Field, Pill, Row, Screen, Title, colors, styles } from "@/components/ui";
import {
  estimateFood,
  lookupBarcode,
  searchFoods,
  type EstimatedFood,
  type FoodEstimate,
  type FoodSearchHit,
  type NutritionPer,
} from "@/lib/api";
import { localIsoDate } from "@/lib/dates";
import { addEntries, mealForTime, recentFoods, type NewFoodEntry } from "@/lib/foodLog";
import { logEntriesToHealth } from "@/lib/health";
import { useProfile } from "@/lib/profile";
import { MEALS, type FoodLogEntry, type FoodSource, type MealName } from "@/lib/types";

/**
 * Logs food that wasn't cooked from the plan: a photo of the meal, a nutrition label, a typed
 * description, a barcode, a USDA search, plain numbers, or something logged before.
 */

type Mode = "home" | "describe" | "barcode" | "quick" | "review" | "detail";

const MEAL_LABEL: Record<MealName, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };
const MULTIPLIERS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** One food being sized before it's logged. */
interface Draft {
  name: string;
  brand: string | null;
  barcode: string | null;
  source: FoodSource;
  perServing: NutritionPer | null;
  servingDesc: string;
  per100g: NutritionPer | null;
  unit: "serving" | "g";
  amount: string;
}

type ReviewItem = EstimatedFood & { include: boolean; mult: number };

const r = (n: number) => Math.round(n);
const r1 = (n: number) => Math.round(n * 10) / 10;

function close() {
  if (router.canGoBack()) router.back();
  else router.replace("/log");
}

export default function LogFood() {
  const params = useLocalSearchParams<{ meal?: string; day?: string }>();
  const { profile } = useProfile();
  const day = params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day) ? params.day : localIsoDate();
  const [meal, setMeal] = useState<MealName>(
    MEALS.includes(params.meal as MealName) ? (params.meal as MealName) : mealForTime(),
  );
  const [mode, setMode] = useState<Mode>("home");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ estimate: FoodEstimate; items: ReviewItem[]; source: FoodSource } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  async function save(entries: NewFoodEntry[]) {
    setBusy(true);
    const { data, error } = await addEntries(entries);
    if (!error) await logEntriesToHealth(profile, data);
    setBusy(false);
    if (error) return Alert.alert("Couldn't log that", error);
    close();
  }

  async function runEstimate(input: { imageUri?: string; mimeType?: string; text?: string }, fallback: FoodSource) {
    setBusy(true);
    try {
      const est = await estimateFood(input);
      if (est.kind === "not_food" || !est.items.length) {
        Alert.alert("No food found", input.imageUri ? "Try a closer photo of the plate or the label." : "Describe what you ate, with amounts if you know them.");
        return;
      }
      setReview({
        estimate: est,
        items: est.items.map((i) => ({ ...i, include: true, mult: 1 })),
        source: est.kind === "label" ? "label" : fallback,
      });
      setMode("review");
    } catch (err) {
      Alert.alert("Couldn't estimate that", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function photo(source: "camera" | "library") {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.6 };
    if (source === "camera" && Platform.OS !== "web") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert("Camera access is needed to photograph your food.");
    }
    const result = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled) return;
    const asset = result.assets[0];
    await runEstimate({ imageUri: asset.uri, mimeType: asset.mimeType ?? "image/jpeg" }, "photo");
  }

  async function barcode(code: string) {
    if (busy) return;
    setBusy(true);
    try {
      const p = await lookupBarcode(code);
      const unit = p.per_serving ? "serving" : "g";
      setDraft({
        name: p.name,
        brand: p.brand,
        barcode: p.barcode,
        source: "barcode",
        perServing: p.per_serving,
        servingDesc: p.serving_desc ?? (p.serving_g ? `${p.serving_g} g` : "1 serving"),
        per100g: p.per_100g,
        unit,
        amount: unit === "serving" ? "1" : String(p.serving_g ?? 100),
      });
      setMode("detail");
    } catch (err) {
      Alert.alert("Barcode not found", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const back = mode === "home" ? null : () => setMode(mode === "detail" && draft?.source === "barcode" ? "barcode" : "home");

  return (
    <Screen>
      <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
        {back ? (
          <Pressable onPress={back} hitSlop={12}>
            <Text style={{ color: colors.brand, fontWeight: "700", fontSize: 17 }}>‹ Back</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable onPress={close} hitSlop={12} accessibilityLabel="Close">
          <Text style={{ color: colors.brand, fontWeight: "700", fontSize: 17 }}>Done</Text>
        </Pressable>
      </Row>

      <Row style={{ flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {MEALS.map((m) => (
          <Chip key={m} label={MEAL_LABEL[m]} selected={meal === m} onPress={() => setMeal(m)} />
        ))}
      </Row>

      {mode === "home" ? (
        <Home
          busy={busy}
          day={day}
          meal={meal}
          onPhoto={photo}
          onMode={setMode}
          onDraft={(d) => {
            setDraft(d);
            setMode("detail");
          }}
          onQuickLog={(e) => save([e])}
        />
      ) : null}

      {mode === "describe" ? <Describe busy={busy} onSubmit={(text) => runEstimate({ text }, "describe")} /> : null}

      {mode === "barcode" ? (
        <>
          <Title sub="Point the camera at the barcode on the package">Scan a barcode</Title>
          <BarcodeScanner onCode={barcode} busy={busy} />
        </>
      ) : null}

      {mode === "quick" ? <QuickAdd busy={busy} onSave={(e) => save([{ ...e, eaten_on: day, meal }])} /> : null}

      {mode === "review" && review ? (
        <Review
          review={review}
          busy={busy}
          onChange={(items) => setReview({ ...review, items })}
          onSave={() =>
            save(
              review.items
                .filter((i) => i.include && i.name.trim())
                .map((i) => ({
                  eaten_on: day,
                  meal,
                  name: i.name,
                  servings: i.mult,
                  serving_desc: i.grams ? `${i.portion} (${i.grams} g)` : i.portion,
                  calories: i.calories,
                  protein_g: i.protein_g,
                  carbs_g: i.carbs_g,
                  fat_g: i.fat_g,
                  fiber_g: i.fiber_g,
                  source: review.source,
                })),
            )
          }
        />
      ) : null}

      {mode === "detail" && draft ? (
        <Detail draft={draft} busy={busy} onChange={setDraft} onSave={(entry) => save([{ ...entry, eaten_on: day, meal }])} />
      ) : null}
    </Screen>
  );
}

function Tile({ emoji, title, onPress, disabled }: { emoji: string; title: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexBasis: "30%",
        flexGrow: 1,
        backgroundColor: colors.card,
        borderRadius: 14,
        paddingVertical: 14,
        alignItems: "center",
        opacity: pressed || disabled ? 0.6 : 1,
      })}
    >
      <Text style={{ fontSize: 24, marginBottom: 4 }}>{emoji}</Text>
      <Text style={[styles.body, { fontWeight: "600", fontSize: 14 }]}>{title}</Text>
    </Pressable>
  );
}

function Home({
  busy,
  day,
  meal,
  onPhoto,
  onMode,
  onDraft,
  onQuickLog,
}: {
  busy: boolean;
  day: string;
  meal: MealName;
  onPhoto: (source: "camera" | "library") => void;
  onMode: (m: Mode) => void;
  onDraft: (d: Draft) => void;
  onQuickLog: (e: NewFoodEntry) => void;
}) {
  const [q, setQ] = useState("");
  const [recents, setRecents] = useState<FoodLogEntry[] | null>(null);
  const [hits, setHits] = useState<{ term: string; results: FoodSearchHit[] }>({ term: "", results: [] });
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    recentFoods().then(setRecents).catch(() => setRecents([]));
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const results = await searchFoods(term);
        if (!cancelled) setHits({ term, results });
      } catch {
        if (!cancelled) setHits({ term, results: [] });
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const term = q.trim().toLowerCase();
  // Results for an older search are hidden rather than cleared from an effect.
  const usda = hits.term.toLowerCase() === term ? hits.results : [];
  const mine = useMemo(
    () => (recents ?? []).filter((e) => !term || e.name.toLowerCase().includes(term) || (e.brand ?? "").toLowerCase().includes(term)),
    [recents, term],
  );

  const fromEntry = (e: FoodLogEntry): Draft => ({
    name: e.name,
    brand: e.brand,
    barcode: e.barcode,
    source: e.source === "recipe" ? "copy" : e.source,
    perServing: { calories: e.calories, protein_g: e.protein_g, carbs_g: e.carbs_g, fat_g: e.fat_g, fiber_g: e.fiber_g },
    servingDesc: e.serving_desc ?? "1 serving",
    per100g: null,
    unit: "serving",
    amount: String(e.servings),
  });

  return (
    <>
      <Title sub="Snap it, scan it, or type it">Log food</Title>
      <Row style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <Tile emoji="📷" title="Meal photo" onPress={() => onPhoto("camera")} disabled={busy} />
        <Tile emoji="🏷️" title="Label" onPress={() => onPhoto("camera")} disabled={busy} />
        <Tile emoji="▦" title="Barcode" onPress={() => onMode("barcode")} disabled={busy} />
        <Tile emoji="✍️" title="Describe" onPress={() => onMode("describe")} disabled={busy} />
        <Tile emoji="🖼️" title="From library" onPress={() => onPhoto("library")} disabled={busy} />
        <Tile emoji="⚡" title="Quick add" onPress={() => onMode("quick")} disabled={busy} />
      </Row>
      {busy ? <Text style={[styles.muted, { marginBottom: 12 }]}>Working out the calories…</Text> : null}

      <Field label="Search" value={q} onChangeText={setQ} placeholder="e.g. greek yogurt, banana, oats" autoCorrect={false} />

      <Text style={styles.h2}>{term ? "Your foods" : "Recent"}</Text>
      {recents === null ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : mine.length === 0 ? (
        <Text style={[styles.muted, { marginBottom: 12 }]}>{term ? "Nothing you've logged matches." : "Foods you log show up here for one-tap logging."}</Text>
      ) : (
        mine.slice(0, term ? 8 : 15).map((e) => (
          <Card key={e.id} style={{ paddingVertical: 10 }}>
            <Row style={{ alignItems: "center", gap: 8 }}>
              <Pressable style={{ flex: 1 }} onPress={() => onDraft(fromEntry(e))}>
                <Text style={[styles.body, { fontWeight: "600" }]} numberOfLines={1}>
                  {e.name}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {r(e.calories * e.servings)} kcal · {Number(e.servings) === 1 ? "" : `${e.servings} × `}
                  {e.serving_desc ?? "serving"}
                  {e.brand ? ` · ${e.brand}` : ""}
                </Text>
              </Pressable>
              <Pressable
                hitSlop={8}
                accessibilityLabel={`Log ${e.name}`}
                onPress={() =>
                  onQuickLog({
                    eaten_on: day,
                    meal,
                    name: e.name,
                    brand: e.brand,
                    barcode: e.barcode,
                    servings: e.servings,
                    serving_desc: e.serving_desc,
                    calories: e.calories,
                    protein_g: e.protein_g,
                    carbs_g: e.carbs_g,
                    fat_g: e.fat_g,
                    fiber_g: e.fiber_g,
                    source: "copy",
                  })
                }
              >
                <Text style={{ color: colors.brand, fontSize: 28, fontWeight: "600", paddingHorizontal: 6 }}>+</Text>
              </Pressable>
            </Row>
          </Card>
        ))
      )}

      {term.length >= 2 ? (
        <>
          <Text style={styles.h2}>USDA foods</Text>
          <Text style={[styles.muted, { marginBottom: 8 }]}>Per 100 g as bought (raw or dry). Weigh before cooking for the best numbers.</Text>
          {searching && !usda.length ? <Text style={styles.muted}>Searching…</Text> : null}
          {!searching && !usda.length ? (
            <Text style={[styles.muted, { marginBottom: 12 }]}>No match. Try Describe instead; it handles dishes and restaurant food.</Text>
          ) : null}
          {usda.map((h) => (
            <Card key={h.fdc_id} style={{ paddingVertical: 10 }}>
              <Pressable
                onPress={() =>
                  onDraft({
                    name: h.name,
                    brand: null,
                    barcode: null,
                    source: "search",
                    perServing: null,
                    servingDesc: "100 g",
                    per100g: {
                      calories: h.calories_kcal_100g ?? 0,
                      protein_g: h.protein_g_100g ?? 0,
                      carbs_g: h.carbs_g_100g ?? 0,
                      fat_g: h.fat_g_100g ?? 0,
                      fiber_g: h.fiber_g_100g,
                    },
                    unit: "g",
                    amount: "100",
                  })
                }
              >
                <Text style={[styles.body, { fontWeight: "600" }]}>{h.name}</Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {r(h.calories_kcal_100g ?? 0)} kcal · P {r1(h.protein_g_100g ?? 0)} · C {r1(h.carbs_g_100g ?? 0)} · F {r1(h.fat_g_100g ?? 0)} · {h.description}
                </Text>
              </Pressable>
            </Card>
          ))}
        </>
      ) : null}
    </>
  );
}

function Describe({ busy, onSubmit }: { busy: boolean; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  return (
    <>
      <Title sub="Say what and how much. Ripe estimates each part.">Describe it</Title>
      <Card>
        <Text style={styles.label}>What you ate</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
          placeholder={"e.g. 2 scrambled eggs, 2 slices sourdough with butter, black coffee\nor: Chipotle chicken burrito bowl"}
          placeholderTextColor={colors.muted}
          style={[styles.input, { minHeight: 96, textAlignVertical: "top" }]}
        />
        <Button label="Estimate" onPress={() => onSubmit(text.trim())} loading={busy} disabled={text.trim().length < 2} />
      </Card>
    </>
  );
}

function QuickAdd({ busy, onSave }: { busy: boolean; onSave: (e: Omit<NewFoodEntry, "eaten_on" | "meal">) => void }) {
  const [name, setName] = useState("");
  const [kcal, setKcal] = useState("");
  const [p, setP] = useState("");
  const [c, setC] = useState("");
  const [f, setF] = useState("");
  const num = (s: string) => Math.max(0, parseFloat(s) || 0);
  const fromMacros = num(p) * 4 + num(c) * 4 + num(f) * 9;
  const calories = kcal.trim() ? num(kcal) : fromMacros;
  return (
    <>
      <Title sub="Just the numbers">Quick add</Title>
      <Card>
        <Field label="Name (optional)" value={name} onChangeText={setName} placeholder="e.g. Office birthday cake" />
        <Field label="Calories" keyboardType="decimal-pad" value={kcal} onChangeText={setKcal} placeholder={fromMacros ? `${r(fromMacros)} from macros` : "kcal"} />
        <Row style={{ gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Protein g" keyboardType="decimal-pad" value={p} onChangeText={setP} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Carbs g" keyboardType="decimal-pad" value={c} onChangeText={setC} />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Fat g" keyboardType="decimal-pad" value={f} onChangeText={setF} />
          </View>
        </Row>
        <Button
          label={`Log ${r(calories)} kcal`}
          loading={busy}
          disabled={calories <= 0}
          onPress={() =>
            onSave({
              name: name.trim() || "Quick add",
              servings: 1,
              serving_desc: "1 serving",
              calories,
              protein_g: num(p),
              carbs_g: num(c),
              fat_g: num(f),
              source: "quick",
            })
          }
        />
      </Card>
    </>
  );
}

function Review({
  review,
  busy,
  onChange,
  onSave,
}: {
  review: { estimate: FoodEstimate; items: ReviewItem[]; source: FoodSource };
  busy: boolean;
  onChange: (items: ReviewItem[]) => void;
  onSave: () => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const edit = (i: number, patch: Partial<ReviewItem>) => onChange(review.items.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const included = review.items.filter((i) => i.include);
  const total = included.reduce(
    (a, i) => ({
      kcal: a.kcal + i.calories * i.mult,
      p: a.p + i.protein_g * i.mult,
      c: a.c + i.carbs_g * i.mult,
      f: a.f + i.fat_g * i.mult,
    }),
    { kcal: 0, p: 0, c: 0, f: 0 },
  );
  const isLabel = review.source === "label";

  return (
    <>
      <Title sub={isLabel ? "Read from the label, per serving as printed" : "Estimates. Fix anything that looks off before logging."}>
        {review.estimate.title || "Review"}
      </Title>

      {review.items.map((item, i) => (
        <Card key={i} style={{ opacity: item.include ? 1 : 0.45 }}>
          <Row style={{ alignItems: "flex-start", gap: 8 }}>
            <Pressable onPress={() => edit(i, { include: !item.include })} hitSlop={8}>
              <Text style={{ fontSize: 20, color: colors.brand }}>{item.include ? "☑" : "☐"}</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <TextInput value={item.name} onChangeText={(name) => edit(i, { name })} style={[styles.body, { fontWeight: "600" }]} />
              <Text style={styles.muted}>
                {item.mult === 1 ? "" : `${item.mult} × `}
                {item.portion}
                {item.grams ? ` (${item.grams} g)` : ""} · {r(item.calories * item.mult)} kcal
              </Text>
              <Text style={styles.muted}>
                P {r1(item.protein_g * item.mult)} · C {r1(item.carbs_g * item.mult)} · F {r1(item.fat_g * item.mult)}
              </Text>
            </View>
            {!isLabel && item.confidence < 0.5 ? <Pill label="rough guess" tone="warn" /> : null}
          </Row>
          {item.include ? (
            <>
              <Row style={{ flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {(isLabel ? [0.5, 1, 1.5, 2, 3] : MULTIPLIERS).map((m) => (
                  <Chip key={m} label={`${m}×`} selected={item.mult === m} onPress={() => edit(i, { mult: m })} />
                ))}
                <Chip label="Edit numbers" selected={editing === i} onPress={() => setEditing(editing === i ? null : i)} />
              </Row>
              {editing === i ? <NumberEditor item={item} onChange={(patch) => edit(i, patch)} /> : null}
            </>
          ) : null}
        </Card>
      ))}

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={styles.h2}>Total</Text>
          <Text style={styles.h2}>{r(total.kcal)} kcal</Text>
        </Row>
        <Text style={styles.muted}>
          Protein {r(total.p)} g · Carbs {r(total.c)} g · Fat {r(total.f)} g
        </Text>
      </Card>
      <Button label={`Log ${included.length} item${included.length === 1 ? "" : "s"}`} onPress={onSave} loading={busy} disabled={!included.length} />
    </>
  );
}

function NumberEditor({ item, onChange }: { item: ReviewItem; onChange: (patch: Partial<ReviewItem>) => void }) {
  const field = (label: string, key: "calories" | "protein_g" | "carbs_g" | "fat_g") => (
    <View style={{ flex: 1 }}>
      <Field
        label={label}
        keyboardType="decimal-pad"
        defaultValue={String(item[key])}
        onChangeText={(t) => onChange({ [key]: Math.max(0, parseFloat(t) || 0) } as Partial<ReviewItem>)}
      />
    </View>
  );
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={[styles.muted, { marginBottom: 6 }]}>For {item.portion}, before the multiplier.</Text>
      <Row style={{ gap: 6 }}>
        {field("kcal", "calories")}
        {field("P g", "protein_g")}
        {field("C g", "carbs_g")}
        {field("F g", "fat_g")}
      </Row>
    </View>
  );
}

function Detail({
  draft,
  busy,
  onChange,
  onSave,
}: {
  draft: Draft;
  busy: boolean;
  onChange: (d: Draft) => void;
  onSave: (e: Omit<NewFoodEntry, "eaten_on" | "meal">) => void;
}) {
  const amount = Math.max(0, parseFloat(draft.amount) || 0);
  const base = draft.unit === "serving" ? draft.perServing : draft.per100g;
  const factor = draft.unit === "serving" ? 1 : amount / 100;
  const per = (k: keyof NutritionPer) => (base ? Number(base[k] ?? 0) * factor : 0);
  const total = draft.unit === "serving" ? amount : 1;

  function submit() {
    if (!base || amount <= 0) return;
    onSave({
      name: draft.name,
      brand: draft.brand,
      barcode: draft.barcode,
      servings: total,
      serving_desc: draft.unit === "serving" ? draft.servingDesc : `${r(amount)} g`,
      calories: per("calories"),
      protein_g: per("protein_g"),
      carbs_g: per("carbs_g"),
      fat_g: per("fat_g"),
      fiber_g: base.fiber_g == null ? null : per("fiber_g"),
      source: draft.source,
    });
  }

  const canGrams = !!draft.per100g;
  const canServings = !!draft.perServing;

  return (
    <>
      <Title sub={draft.brand ?? (draft.source === "search" ? "USDA FoodData Central" : undefined)}>{draft.name}</Title>
      <Card>
        {canGrams && canServings ? (
          <Row style={{ gap: 6, marginBottom: 10 }}>
            <Chip
              label={`Servings (${draft.servingDesc})`}
              selected={draft.unit === "serving"}
              onPress={() => onChange({ ...draft, unit: "serving", amount: "1" })}
            />
            <Chip label="Grams" selected={draft.unit === "g"} onPress={() => onChange({ ...draft, unit: "g", amount: "100" })} />
          </Row>
        ) : null}
        <Field
          label={draft.unit === "serving" ? `Servings of ${draft.servingDesc}` : "Grams"}
          keyboardType="decimal-pad"
          value={draft.amount}
          onChangeText={(amount) => onChange({ ...draft, amount })}
          autoFocus
        />
        <Row style={{ justifyContent: "space-between", marginBottom: 4 }}>
          <Text style={styles.h2}>{r(per("calories") * total)} kcal</Text>
        </Row>
        <Text style={[styles.muted, { marginBottom: 12 }]}>
          Protein {r1(per("protein_g") * total)} g · Carbs {r1(per("carbs_g") * total)} g · Fat {r1(per("fat_g") * total)} g
          {base?.fiber_g != null ? ` · Fiber ${r1(per("fiber_g") * total)} g` : ""}
        </Text>
        <Button label="Log it" onPress={submit} loading={busy} disabled={!base || amount <= 0} />
      </Card>
    </>
  );
}
