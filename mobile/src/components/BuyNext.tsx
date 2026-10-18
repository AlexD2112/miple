import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Share, Text, View } from "react-native";
import { Button, Card, Row, colors, styles } from "@/components/ui";
import { addPantryItem } from "@/lib/pantry";
import { useProfile } from "@/lib/profile";
import { quickPicks, suggestPurchases, type BuySuggestion } from "@/lib/shopping";
import { supabase } from "@/lib/supabase";
import type { Item } from "@/lib/types";

/** "What should I buy next?": the groceries that unlock the most meals with what you already have. */
export function BuyNext() {
  const { profile } = useProfile();
  const [items, setItems] = useState<BuySuggestion[] | null>(null);
  const [source, setSource] = useState<"gemini" | "offline">("gemini");
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const ai = await suggestPurchases(6);
    if (ai && ai.length) {
      setItems(ai);
      setSource("gemini");
    } else {
      const { data } = await supabase.from("items").select("name, category").eq("status", "active");
      setItems(quickPicks((data ?? []) as Pick<Item, "name" | "category">[], profile));
      setSource("offline");
    }
    setLoading(false);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  async function bought(s: BuySuggestion) {
    setAdding(s.name);
    const { error } = await addPantryItem({ name: s.name, price: s.est_price });
    setAdding(null);
    if (error) return Alert.alert("Couldn't add", error);
    setItems((prev) => (prev ?? []).filter((x) => x.name !== s.name));
  }

  const total = (items ?? []).reduce((a, s) => a + s.est_price, 0);

  return (
    <Card>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h2}>Buy next</Text>
          <Text style={[styles.muted, { marginBottom: 10 }]}>
            {source === "gemini" ? "Picked by Gemini to unlock the most meals with what you have." : "Quick picks to fill gaps in your pantry."}
          </Text>
        </View>
        <Pressable onPress={load} disabled={loading} hitSlop={10}>
          <Text style={{ color: colors.brand, fontWeight: "700", fontSize: 15 }}>{loading ? "" : "Refresh"}</Text>
        </Pressable>
      </Row>

      {loading && !items ? <ActivityIndicator color={colors.brand} style={{ marginVertical: 20 }} /> : null}

      {(items ?? []).map((s, i) => (
        <View key={s.name} style={{ paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: colors.border }}>
          <Row style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={[styles.body, { fontWeight: "700" }]}>
                {i + 1}. {s.name}
              </Text>
              <Text style={[styles.muted, { marginTop: 2 }]}>{s.why}</Text>
              {s.pairs_with.length ? (
                <Text style={[styles.label, { marginTop: 6, marginBottom: 0 }]}>With your {s.pairs_with.slice(0, 3).join(", ")}</Text>
              ) : null}
              {s.meals.length ? <Text style={[styles.label, { marginTop: 2, marginBottom: 0 }]}>Makes: {s.meals.slice(0, 3).join(" · ")}</Text> : null}
            </View>
            <View style={{ alignItems: "flex-end", gap: 6 }}>
              <Text style={[styles.body, { fontWeight: "700" }]}>~${s.est_price.toFixed(2)}</Text>
              <Button small kind="secondary" label="Bought" onPress={() => bought(s)} loading={adding === s.name} />
            </View>
          </Row>
        </View>
      ))}

      {items && items.length ? (
        <>
          <Row style={{ justifyContent: "space-between", marginTop: 6, marginBottom: 10 }}>
            <Text style={styles.muted}>Estimated total</Text>
            <Text style={[styles.body, { fontWeight: "700" }]}>~${total.toFixed(2)}</Text>
          </Row>
          <Button
            kind="secondary"
            label="Share shopping list"
            onPress={() => Share.share({ message: `Miple shopping list:\n${items.map((s) => `• ${s.name} (~$${s.est_price.toFixed(2)})`).join("\n")}` })}
          />
        </>
      ) : null}
      {items && !items.length && !loading ? <Text style={styles.muted}>You're stocked up. Tap Refresh after you cook a few meals.</Text> : null}
    </Card>
  );
}
