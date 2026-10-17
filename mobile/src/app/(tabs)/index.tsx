import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Button, Card, Chip, Field, Pill, Row, Screen, Title, styles } from "@/components/ui";
import { addDaysIso, daysUntil, expiryLabel } from "@/lib/dates";
import { currentUserId, supabase } from "@/lib/supabase";
import type { Item } from "@/lib/types";
import { useFocusData } from "@/lib/useFocusData";

const QUICK_CATEGORIES = ["leafy_greens", "fresh_vegetables", "fresh_fruit", "raw_poultry", "raw_meat", "dairy_milk", "eggs", "bread", "other"];

export default function Pantry() {
  const [items, reload] = useFocusData(async () => {
    const { data, error } = await supabase
      .from("items")
      .select("*")
      .eq("status", "active")
      .order("estimated_expiry", { ascending: true });
    if (error) throw error;
    return data as Item[];
  });

  const [name, setName] = useState("");
  const [category, setCategory] = useState<string>("other");
  const [adding, setAdding] = useState(false);

  async function quickAdd() {
    if (!name.trim()) return;
    setAdding(true);
    // Expiry is filled in by the database from the category's shelf life.
    const { error } = await supabase.from("items").insert({
      user_id: await currentUserId(),
      name: name.trim(),
      category,
      source: "manual",
    });
    setAdding(false);
    if (error) return Alert.alert("Couldn't add item", error.message);
    setName("");
    reload();
  }

  async function update(item: Item, patch: Partial<Item>) {
    const { error } = await supabase.from("items").update(patch).eq("id", item.id);
    if (error) Alert.alert("Update failed", error.message);
    reload();
  }

  const urgent = (items ?? []).filter((i) => daysUntil(i.estimated_expiry) <= 2);

  return (
    <Screen>
      <Title sub={urgent.length ? `${urgent.length} item${urgent.length > 1 ? "s" : ""} expiring within 2 days` : "Nothing urgent. Nice."}>
        Pantry
      </Title>

      <Card>
        <Text style={styles.h2}>Quick add</Text>
        <Field label="Item" value={name} onChangeText={setName} placeholder="e.g. spinach" onSubmitEditing={quickAdd} />
        <Row style={{ flexWrap: "wrap", marginBottom: 10 }}>
          {QUICK_CATEGORIES.map((c) => (
            <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </Row>
        <Button label="Add to pantry" onPress={quickAdd} loading={adding} disabled={!name.trim()} />
      </Card>

      {(items ?? []).map((item) => {
        const n = daysUntil(item.estimated_expiry);
        const tone = n < 0 ? "danger" : n <= 1 ? "danger" : n <= 3 ? "warn" : "good";
        return (
          <Card key={item.id}>
            <Row style={{ justifyContent: "space-between" }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.body}>{item.name}</Text>
                <Text style={styles.muted}>
                  {item.quantity}
                  {item.unit ? ` ${item.unit}` : ""} · {item.category.replace(/_/g, " ")}
                  {item.source === "leftover" ? " · leftover" : ""}
                  {item.price != null ? ` · $${item.price.toFixed(2)}` : ""}
                </Text>
              </View>
              <Pill label={expiryLabel(item.estimated_expiry)} tone={tone} />
            </Row>
            <Row style={{ marginTop: 10 }}>
              <Button small kind="secondary" label="−1d" onPress={() => update(item, { estimated_expiry: addDaysIso(item.estimated_expiry, -1) })} />
              <Button small kind="secondary" label="+1d" onPress={() => update(item, { estimated_expiry: addDaysIso(item.estimated_expiry, 1) })} />
              <View style={{ flex: 1 }} />
              <Button small kind="secondary" label="Used" onPress={() => update(item, { status: "used" })} />
              <Button small kind="danger" label="Tossed" onPress={() => update(item, { status: "wasted" })} />
            </Row>
          </Card>
        );
      })}

      {items && items.length === 0 ? (
        <Text style={[styles.muted, { textAlign: "center", marginTop: 24 }]}>Your pantry is empty. Scan a receipt to fill it.</Text>
      ) : null}
    </Screen>
  );
}
