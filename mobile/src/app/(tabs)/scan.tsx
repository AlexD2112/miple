import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { Button, Card, Pill, Row, Screen, Title, colors, styles } from "@/components/ui";
import { parseReceipt } from "@/lib/api";
import { expiryLabel } from "@/lib/dates";
import { currentUserId, supabase } from "@/lib/supabase";
import type { ParsedReceipt, ParsedReceiptItem } from "@/lib/types";

type Draft = ParsedReceiptItem & { include: boolean };

export default function Scan() {
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [receipt, setReceipt] = useState<ParsedReceipt | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);

  async function pick(source: "camera" | "library") {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7 };
    if (source === "camera") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert("Camera access is needed to scan receipts.");
    }
    const result =
      source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled) return;

    const asset = result.assets[0];
    setParsing(true);
    try {
      const parsed = await parseReceipt(asset.uri, asset.mimeType ?? "image/jpeg");
      setReceipt(parsed);
      setDrafts(parsed.items.map((i) => ({ ...i, include: true })));
    } catch (err) {
      Alert.alert("Couldn't read that receipt", String(err));
    } finally {
      setParsing(false);
    }
  }

  async function save() {
    if (!receipt) return;
    setSaving(true);
    try {
      const user_id = await currentUserId();
      const { data: row, error } = await supabase
        .from("receipts")
        .insert({ user_id, store: receipt.store, purchased_at: receipt.purchased_at, total: receipt.total })
        .select("id")
        .single();
      if (error) throw error;

      const items = drafts
        .filter((d) => d.include && d.name.trim())
        .map((d) => ({
          user_id,
          receipt_id: row.id,
          name: d.name.trim(),
          raw_name: d.raw_name,
          category: d.category,
          quantity: d.quantity,
          unit: d.unit,
          price: d.price,
          purchase_date: d.purchase_date,
          estimated_expiry: d.estimated_expiry,
          source: "receipt",
        }));
      const { error: itemsError } = await supabase.from("items").insert(items);
      if (itemsError) throw itemsError;

      setReceipt(null);
      setDrafts([]);
      router.navigate("/");
    } catch (err) {
      Alert.alert("Save failed", String(err));
    } finally {
      setSaving(false);
    }
  }

  const edit = (i: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));

  if (!receipt) {
    return (
      <Screen>
        <Title sub="Snap your grocery receipt. Ripe reads the items, prices and guesses expiry dates.">Scan</Title>
        <Card>
          <Button label="Take photo" onPress={() => pick("camera")} loading={parsing} />
          <View style={{ height: 8 }} />
          <Button kind="secondary" label="Choose from library" onPress={() => pick("library")} disabled={parsing} />
          {parsing ? <Text style={[styles.muted, { marginTop: 10 }]}>Reading receipt…</Text> : null}
        </Card>
      </Screen>
    );
  }

  const included = drafts.filter((d) => d.include);
  return (
    <Screen>
      <Title sub={`${receipt.store ?? "Receipt"} · ${receipt.purchased_at}${receipt.total != null ? ` · $${receipt.total.toFixed(2)}` : ""}`}>
        Review
      </Title>
      <Text style={[styles.muted, { marginBottom: 10 }]}>Tap a name to fix it. Untick anything that isn't food.</Text>

      {drafts.map((d, i) => (
        <Card key={i} style={{ opacity: d.include ? 1 : 0.45 }}>
          <Row>
            <Pressable onPress={() => edit(i, { include: !d.include })} hitSlop={8}>
              <Text style={{ fontSize: 20, color: colors.brand }}>{d.include ? "☑" : "☐"}</Text>
            </Pressable>
            <View style={{ flex: 1 }}>
              <TextInput value={d.name} onChangeText={(name) => edit(i, { name })} style={[styles.body, { fontWeight: "600" }]} />
              <Text style={styles.muted}>
                {d.raw_name} · {d.category.replace(/_/g, " ")}
                {d.price != null ? ` · $${d.price.toFixed(2)}` : ""}
              </Text>
            </View>
            <Pill label={expiryLabel(d.estimated_expiry)} tone="good" />
          </Row>
        </Card>
      ))}

      <Button label={`Add ${included.length} items to pantry`} onPress={save} loading={saving} disabled={!included.length} />
      <View style={{ height: 8 }} />
      <Button kind="secondary" label="Discard" onPress={() => setReceipt(null)} />
    </Screen>
  );
}
