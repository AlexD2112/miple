import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Row, colors, styles } from "@/components/ui";
import { ALLERGENS, DIETS } from "@/lib/types";

const pretty = (s: string) => {
  const t = s.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** One row ("Diet  Omnivore ›") that opens a list; the last option lets you type your own. */
export function DietPicker({ value, onChange }: { value: string; onChange: (diet: string) => void }) {
  const known = (DIETS as readonly string[]).includes(value);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(!known);
  const [text, setText] = useState(known ? "" : value);

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(!open)}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 }}
      >
        <Text style={styles.h2}>Diet</Text>
        <Text style={[styles.body, { color: colors.muted }]}>
          {value ? pretty(value) : "Choose"} {open ? "▴" : "▾"}
        </Text>
      </Pressable>

      {open ? (
        <View style={{ marginTop: 4, borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
          {[...DIETS, "custom"].map((d, i) => {
            const selected = d === "custom" ? custom : !custom && value === d;
            return (
              <Pressable
                key={d}
                onPress={() => {
                  if (d === "custom") {
                    setCustom(true);
                    if (text.trim()) onChange(text.trim().toLowerCase());
                  } else {
                    setCustom(false);
                    onChange(d);
                    setOpen(false);
                  }
                }}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  backgroundColor: pressed ? colors.bg : "transparent",
                  borderTopWidth: i ? 1 : 0,
                  borderColor: colors.border,
                })}
              >
                <Text style={styles.body}>{d === "custom" ? "Custom…" : pretty(d)}</Text>
                {selected ? <Text style={[styles.body, { color: colors.brand, fontWeight: "700" }]}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {custom ? (
        <TextInput
          value={text}
          onChangeText={(t) => {
            setText(t);
            if (t.trim()) onChange(t.trim().toLowerCase());
          }}
          onSubmitEditing={() => setOpen(false)}
          placeholder="Type your diet, e.g. jain, paleo, low FODMAP"
          placeholderTextColor={colors.muted}
          autoFocus={open}
          returnKeyType="done"
          style={[styles.input, { marginTop: 10 }]}
        />
      ) : null}
    </View>
  );
}

// Common ways people type an allergy, mapped to the keys the recipe safety filter understands.
const SYNONYMS: Record<string, (typeof ALLERGENS)[number]> = {
  peanut: "peanut", peanuts: "peanut", groundnut: "peanut",
  nut: "tree_nut", nuts: "tree_nut", "tree nut": "tree_nut", "tree nuts": "tree_nut", almond: "tree_nut", almonds: "tree_nut",
  cashew: "tree_nut", cashews: "tree_nut", walnut: "tree_nut", walnuts: "tree_nut", pecan: "tree_nut", pistachio: "tree_nut", hazelnut: "tree_nut",
  milk: "milk", dairy: "milk", lactose: "milk", cheese: "milk",
  egg: "egg", eggs: "egg",
  wheat: "wheat", gluten: "gluten", celiac: "gluten", coeliac: "gluten",
  soy: "soy", soya: "soy", tofu: "soy",
  fish: "fish", salmon: "fish", tuna: "fish",
  shellfish: "shellfish", shrimp: "shellfish", prawn: "shellfish", crab: "shellfish", lobster: "shellfish", oyster: "shellfish",
  sesame: "sesame", tahini: "sesame",
};

function canonical(text: string): string {
  const t = text.trim().toLowerCase();
  return SYNONYMS[t] ?? (ALLERGENS as readonly string[]).find((a) => a.replace(/_/g, " ") === t) ?? t;
}

/** Type to add: suggestions steer to the filter's known allergens; anything else is kept as typed. */
export function AllergyInput({ value, onChange }: { value: string[]; onChange: (allergies: string[]) => void }) {
  const [text, setText] = useState("");
  const q = text.trim().toLowerCase();

  const add = (a: string) => {
    const key = canonical(a);
    if (key && !value.includes(key)) onChange([...value, key]);
    setText("");
  };

  const suggestions = q
    ? Array.from(
        new Set(
          [
            ...ALLERGENS.filter((a) => a.replace(/_/g, " ").includes(q)),
            ...Object.entries(SYNONYMS).filter(([k]) => k.startsWith(q)).map(([, v]) => v),
          ].filter((a) => !value.includes(a)),
        ),
      ).slice(0, 5)
    : ALLERGENS.filter((a) => !value.includes(a)).slice(0, 6);

  return (
    <View>
      {value.length ? (
        <Row style={{ flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {value.map((a) => (
            <Pressable
              key={a}
              accessibilityLabel={`Remove ${pretty(a)}`}
              onPress={() => onChange(value.filter((x) => x !== a))}
              style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brand, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 12 }}
            >
              <Text style={{ color: "#fff", fontSize: 15, fontWeight: "600" }}>{pretty(a)}</Text>
              <Text style={{ color: "#fff", fontSize: 15, opacity: 0.8 }}>✕</Text>
            </Pressable>
          ))}
        </Row>
      ) : (
        <Text style={[styles.muted, { marginBottom: 10 }]}>No allergies added.</Text>
      )}

      <TextInput
        value={text}
        onChangeText={setText}
        onSubmitEditing={() => q && add(q)}
        placeholder="Add an allergy, e.g. peanuts, dairy, kiwi"
        placeholderTextColor={colors.muted}
        returnKeyType="done"
        autoCapitalize="none"
        style={styles.input}
      />

      <Row style={{ flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {suggestions.map((a) => (
          <Pressable
            key={a}
            onPress={() => add(a)}
            style={{ borderRadius: 999, borderWidth: 1, borderColor: colors.border, paddingVertical: 6, paddingHorizontal: 12 }}
          >
            <Text style={{ color: colors.text, fontSize: 14 }}>+ {pretty(a)}</Text>
          </Pressable>
        ))}
        {q && !suggestions.includes(canonical(q) as never) && !value.includes(canonical(q)) ? (
          <Pressable
            onPress={() => add(q)}
            style={{ borderRadius: 999, borderWidth: 1, borderColor: colors.brand, paddingVertical: 6, paddingHorizontal: 12 }}
          >
            <Text style={{ color: colors.brand, fontSize: 14, fontWeight: "600" }}>+ Add “{text.trim()}”</Text>
          </Pressable>
        ) : null}
      </Row>
    </View>
  );
}
