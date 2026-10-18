import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { Button, Card, Chip, Field, Row, Screen, Title, colors, styles } from "@/components/ui";
import { guessCategory } from "@/lib/api";
import { logMealToHealth } from "@/lib/health";
import { useProfile } from "@/lib/profile";
import { addPantryItem, describeShelfLife } from "@/lib/pantry";
import { currentUserId, supabase } from "@/lib/supabase";
import type { Recipe } from "@/lib/types";

/**
 * MacroFactor-style quick-add sheet, opened from the center "+" tab:
 * log a weigh-in, add a pantry item that wasn't on a receipt, ask the chef,
 * or re-log a recent recipe.
 */

type Mode = "weight" | "pantry" | "chef" | null;

// Same key and shape the weight trend feature reads, so entries carry over.
const WEIGHT_KEY = "miple.weights.v1";
const CATEGORIES = ["leafy_greens", "fresh_vegetables", "fresh_fruit", "raw_poultry", "raw_meat", "dairy_milk", "eggs", "bread", "other"];
const CHEF_IDEAS = ["What can I make right now?", "Use what's expiring first", "High-protein dinner under 20 min"];

const label = (c: string) => c.replace(/_/g, " ");

function close() {
  if (router.canGoBack()) router.back();
  else router.replace("/");
}

export default function QuickAdd() {
  const [mode, setMode] = useState<Mode>(null);

  return (
    <Screen>
      <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
        {mode ? (
          <Pressable onPress={() => setMode(null)} hitSlop={12}>
            <Text style={{ color: colors.brand, fontWeight: "700", fontSize: 17 }}>‹ Back</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable onPress={close} hitSlop={12} accessibilityLabel="Close">
          <Text style={{ color: colors.brand, fontWeight: "700", fontSize: 17 }}>Done</Text>
        </Pressable>
      </Row>

      {mode === null ? <Home onPick={setMode} /> : null}
      {mode === "weight" ? <WeightForm /> : null}
      {mode === "pantry" ? <PantryForm /> : null}
      {mode === "chef" ? <ChefForm /> : null}
    </Screen>
  );
}

function Home({ onPick }: { onPick: (m: Mode) => void }) {
  return (
    <>
      <Title sub="Log something in a couple of taps">Quick add</Title>
      <Row style={{ gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <Tile
          emoji="🧾"
          title="Scan receipt"
          onPress={() => {
            close();
            router.navigate("/scan");
          }}
        />
        <Tile emoji="⚖️" title="Weight" onPress={() => onPick("weight")} />
        <Tile emoji="🥕" title="Pantry item" onPress={() => onPick("pantry")} />
        <Tile emoji="👨‍🍳" title="Ask chef" onPress={() => onPick("chef")} />
      </Row>
      <Recents />
    </>
  );
}

function Tile({ emoji, title, onPress }: { emoji: string; title: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexBasis: "47%",
        flexGrow: 1,
        backgroundColor: colors.card,
        borderRadius: 16,
        paddingVertical: 18,
        alignItems: "center",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={{ fontSize: 28, marginBottom: 6 }}>{emoji}</Text>
      <Text style={[styles.body, { fontWeight: "600", fontSize: 15 }]}>{title}</Text>
    </Pressable>
  );
}

function WeightForm() {
  const [lb, setLb] = useState("");
  const [last, setLast] = useState<{ date: string; lb: number } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(WEIGHT_KEY)
      .then((raw) => {
        const list = raw ? (JSON.parse(raw) as { date: string; lb: number }[]) : [];
        setLast(list.length ? list[list.length - 1] : null);
      })
      .catch(() => {});
  }, []);

  async function save() {
    const value = parseFloat(lb);
    if (!value || value < 50 || value > 700) return Alert.alert("Enter your weight in lb");
    try {
      const raw = await AsyncStorage.getItem(WEIGHT_KEY);
      const list = raw ? (JSON.parse(raw) as { date: string; lb: number }[]) : [];
      await AsyncStorage.setItem(WEIGHT_KEY, JSON.stringify([...list, { date: new Date().toISOString(), lb: value }].slice(-365)));
      Alert.alert("Weight logged", `${value} lb`);
      close();
    } catch (err) {
      Alert.alert("Couldn't save", String(err));
    }
  }

  return (
    <>
      <Title sub={last ? `Last: ${last.lb} lb on ${new Date(last.date).toLocaleDateString()}` : "Log your morning weigh-in"}>Weight</Title>
      <Card>
        <Field label="Weight (lb)" keyboardType="decimal-pad" value={lb} onChangeText={setLb} placeholder="e.g. 172.4" autoFocus />
        <Button label="Log weight" onPress={save} disabled={!lb.trim()} />
      </Card>
    </>
  );
}

function PantryForm() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("other");
  // True once the user taps a chip; then we stop overriding their choice.
  const [picked, setPicked] = useState(false);
  const [guessing, setGuessing] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState("");

  // Category sets the expiry date, so pick it from the name (USDA matcher, then LLM) as the user types.
  useEffect(() => {
    const trimmed = name.trim();
    if (picked || trimmed.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setGuessing(true);
      try {
        const g = await guessCategory(trimmed);
        if (!cancelled) setCategory(g.category);
      } catch {
        // Offline or server down: keep the current chip.
      } finally {
        if (!cancelled) setGuessing(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [name, picked]);

  async function add(another: boolean) {
    if (!name.trim()) return;
    setSaving(true);
    // Gemini estimates how long it keeps (and the category unless the user tapped a chip).
    // Offline, a keyword guess picks the category and its default shelf life.
    const q = parseFloat(quantity);
    const pr = parseFloat(price);
    const { error, estimate } = await addPantryItem({
      name,
      category: picked ? category : undefined,
      quantity: q > 0 ? q : undefined,
      price: price.trim() && pr >= 0 ? pr : undefined,
    });
    setSaving(false);
    if (error) return Alert.alert("Couldn't add item", error);
    if (another) {
      setNote(`Added ${name.trim()}. ${describeShelfLife(estimate)}`);
      setName("");
      setQuantity("");
      setPrice("");
      setCategory("other");
      setPicked(false);
    } else {
      close();
    }
  }

  const chips = CATEGORIES.includes(category) ? CATEGORIES : [category, ...CATEGORIES];

  return (
    <>
      <Title sub="For things that weren't on a receipt">Add to pantry</Title>
      <Card>
        <Field label="Item" value={name} onChangeText={setName} placeholder="e.g. eggs from the farmers market" autoFocus />
        <Text style={styles.label}>
          Category (sets the expiry date){guessing ? " · picking…" : picked ? "" : " · picked automatically, tap to change"}
        </Text>
        <Row style={{ flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {chips.map((c) => (
            <Chip
              key={c}
              label={label(c)}
              selected={category === c}
              onPress={() => {
                setCategory(c);
                setPicked(true);
              }}
            />
          ))}
        </Row>
        <Row style={{ gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Field label="Quantity" keyboardType="decimal-pad" value={quantity} onChangeText={setQuantity} placeholder="1" />
          </View>
          <View style={{ flex: 1 }}>
            <Field label="Price ($, optional)" keyboardType="decimal-pad" value={price} onChangeText={setPrice} placeholder="3.99" />
          </View>
        </Row>
        <Button label="Add to pantry" onPress={() => add(false)} loading={saving} disabled={!name.trim()} />
        <View style={{ height: 8 }} />
        <Button kind="secondary" label="Add and log another" onPress={() => add(true)} disabled={!name.trim() || saving} />
        {note ? <Text style={[styles.muted, { marginTop: 10 }]}>{note}</Text> : null}
      </Card>
    </>
  );
}

function ChefForm() {
  const [q, setQ] = useState("");
  const ask = (text: string) => {
    if (!text.trim()) return;
    router.replace({ pathname: "/chef", params: { q: text.trim() } });
  };
  return (
    <>
      <Title sub="Your chef knows your pantry, calendar and macros">Ask your chef</Title>
      <Card>
        <Field label="Ask anything" value={q} onChangeText={setQ} placeholder="e.g. something with the chicken tonight" autoFocus onSubmitEditing={() => ask(q)} />
        <Row style={{ flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {CHEF_IDEAS.map((s) => (
            <Chip key={s} label={s} onPress={() => ask(s)} />
          ))}
        </Row>
        <Button label="Ask" onPress={() => ask(q)} disabled={!q.trim()} />
      </Card>
    </>
  );
}

/** Recent recipes, MacroFactor-style: tap to see macros, then re-log or ask the chef for it again. */
function Recents() {
  const { profile } = useProfile();
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("recipes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10)
      .then(({ data }) => setRecipes((data ?? []) as Recipe[]));
  }, []);

  async function logEaten(r: Recipe) {
    if (!profile?.healthkit_enabled) {
      return Alert.alert("Turn on Apple Health", "Enable Apple Health on the Me tab to log meals there.");
    }
    const ok = await logMealToHealth(r);
    Alert.alert(ok ? "Logged" : "Couldn't log", ok ? `${r.title} was added to Apple Health.` : "Apple Health didn't accept it.");
  }

  return (
    <>
      <Text style={styles.h2}>Recents</Text>
      {recipes === null ? (
        <Text style={styles.muted}>Loading…</Text>
      ) : recipes.length === 0 ? (
        <Text style={styles.muted}>Recipes you plan or cook will show up here.</Text>
      ) : (
        recipes.map((r) => (
          <Card key={r.id}>
            <Pressable onPress={() => setOpen(open === r.id ? null : r.id)}>
              <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
                <Text style={[styles.body, { fontWeight: "600", flex: 1, marginRight: 8 }]} numberOfLines={1}>
                  {r.title}
                </Text>
                <Text style={styles.muted}>{r.calories} kcal</Text>
              </Row>
              <Text style={[styles.muted, { marginTop: 2 }]}>
                P {r.protein_g}g · C {r.carbs_g}g · F {r.fat_g}g · {r.minutes} min
              </Text>
            </Pressable>
            {open === r.id ? (
              <View style={{ marginTop: 10 }}>
                {r.ingredients.slice(0, 8).map((i, idx) => (
                  <Text key={idx} style={styles.muted}>
                    • {i.quantity} {i.name}
                  </Text>
                ))}
                <Row style={{ gap: 8, marginTop: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Button small label="Log as eaten" onPress={() => logEaten(r)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      small
                      kind="secondary"
                      label="Make again"
                      onPress={() => router.replace({ pathname: "/chef", params: { q: `Plan ${r.title} again soon` } })}
                    />
                  </View>
                </Row>
              </View>
            ) : null}
          </Card>
        ))
      )}
    </>
  );
}
