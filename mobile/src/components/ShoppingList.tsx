import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";
import { Alert, Platform, Pressable, Share, Text, TextInput, View } from "react-native";
import { Button, Card, Field, Row, colors, styles } from "@/components/ui";
import { scanShoppingList, type ScannedListItem } from "@/lib/api";
import { addPantryItem } from "@/lib/pantry";
import { addToList, listText, loadList, removeFromList, setChecked } from "@/lib/shoppingList";
import type { ShoppingListItem } from "@/lib/types";

type Scanned = ScannedListItem & { include: boolean };

/** The shopping list: type items, scan a handwritten or printed list, check things off, move them to the pantry. */
export function ShoppingList({ refreshKey }: { refreshKey?: number }) {
  const [items, setItems] = useState<ShoppingListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<Scanned[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await loadList();
    setItems(res.items);
    setError(res.error);
  }, []);

  useEffect(() => {
    let alive = true;
    loadList().then((res) => {
      if (!alive) return;
      setItems(res.items);
      setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  async function add() {
    const text = name.trim();
    if (!text) return;
    // "eggs, milk, 2 lb chicken" adds three items.
    const parts = text.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
    const res = await addToList(parts.map((p) => ({ name: p })));
    if (res.error) return Alert.alert("Couldn't add", res.error);
    setName("");
    load();
  }

  async function scan(source: "camera" | "library") {
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7 };
    if (source === "camera" && Platform.OS !== "web") {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return Alert.alert("Camera access is needed to scan a list.");
    }
    const result = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    if (result.canceled) return;
    const asset = result.assets[0];
    setScanning(true);
    try {
      const found = await scanShoppingList(asset.uri, asset.mimeType ?? "image/jpeg");
      if (!found.length) return Alert.alert("No items found", "Try a closer, well-lit photo of the list.");
      setScanned(found.map((f) => ({ ...f, include: true })));
    } catch (err) {
      Alert.alert("Couldn't read that list", err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  }

  async function addScanned() {
    if (!scanned) return;
    const res = await addToList(scanned.filter((s) => s.include && s.name.trim()), "scan");
    if (res.error) return Alert.alert("Couldn't add", res.error);
    setScanned(null);
    load();
  }

  async function toggle(item: ShoppingListItem) {
    setItems((list) => (list ?? []).map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i)));
    await setChecked(item.id, !item.checked);
  }

  const checked = (items ?? []).filter((i) => i.checked);
  const open = (items ?? []).filter((i) => !i.checked);

  async function moveToPantry() {
    setBusy(true);
    let failed = 0;
    for (const i of checked) {
      const q = parseFloat(i.quantity ?? "");
      const res = await addPantryItem({
        name: i.name,
        category: i.category === "other" ? undefined : i.category,
        quantity: q > 0 ? q : undefined,
      });
      if (res.error) failed++;
    }
    await removeFromList(checked.map((i) => i.id));
    setBusy(false);
    if (failed) Alert.alert("Some items weren't added", `${failed} couldn't be saved to the pantry.`);
    load();
  }

  if (scanned) {
    return (
      <Card>
        <Text style={styles.h2}>Found {scanned.length} items</Text>
        <Text style={[styles.muted, { marginBottom: 8 }]}>{"Fix any names and untick anything you don't need."}</Text>
        {scanned.map((s, idx) => (
          <Row key={idx} style={{ alignItems: "center", gap: 8, paddingVertical: 4, opacity: s.include ? 1 : 0.45 }}>
            <Pressable onPress={() => setScanned(scanned.map((x, j) => (j === idx ? { ...x, include: !x.include } : x)))} hitSlop={8}>
              <Text style={{ fontSize: 20, color: colors.brand }}>{s.include ? "☑" : "☐"}</Text>
            </Pressable>
            <TextInput
              value={s.name}
              onChangeText={(t) => setScanned(scanned.map((x, j) => (j === idx ? { ...x, name: t } : x)))}
              style={[styles.body, { flex: 1 }]}
            />
            {s.quantity ? <Text style={styles.muted}>{s.quantity}</Text> : null}
          </Row>
        ))}
        <View style={{ height: 8 }} />
        <Button label={`Add ${scanned.filter((s) => s.include).length} to list`} onPress={addScanned} />
        <View style={{ height: 8 }} />
        <Button kind="secondary" label="Cancel" onPress={() => setScanned(null)} />
      </Card>
    );
  }

  return (
    <Card>
      <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
        <Text style={styles.h2}>Shopping list</Text>
        {open.length ? (
          <Pressable onPress={() => Share.share({ message: `Shopping list:\n${listText(items ?? [])}` })} hitSlop={10}>
            <Text style={{ color: colors.brand, fontWeight: "700" }}>Share</Text>
          </Pressable>
        ) : null}
      </Row>
      {error ? <Text style={[styles.muted, { marginBottom: 8 }]}>{"The shopping list isn't set up on the server yet (migration 0005)."}</Text> : null}

      <Field label="Add items" value={name} onChangeText={setName} placeholder="e.g. eggs, oat milk, 2 lb chicken" onSubmitEditing={add} />
      <Row style={{ gap: 8, marginBottom: 12 }}>
        <View style={{ flex: 1 }}>
          <Button small label="Add" onPress={add} disabled={!name.trim()} />
        </View>
        <View style={{ flex: 1 }}>
          <Button small kind="secondary" label="Scan a list" onPress={() => scan("camera")} loading={scanning} />
        </View>
        <View style={{ flex: 1 }}>
          <Button small kind="secondary" label="From photo" onPress={() => scan("library")} disabled={scanning} />
        </View>
      </Row>
      {scanning ? <Text style={[styles.muted, { marginBottom: 8 }]}>Reading your list…</Text> : null}

      {items === null ? <Text style={styles.muted}>Loading…</Text> : null}
      {items && !items.length ? (
        <Text style={styles.muted}>Nothing on your list. Type items, snap a handwritten list, or add picks from below.</Text>
      ) : null}
      {[...open, ...checked].map((i) => (
        <Row key={i.id} style={{ alignItems: "center", gap: 10, paddingVertical: 6 }}>
          <Pressable onPress={() => toggle(i)} hitSlop={8} accessibilityRole="checkbox" accessibilityState={{ checked: i.checked }}>
            <Text style={{ fontSize: 20, color: colors.brand }}>{i.checked ? "☑" : "☐"}</Text>
          </Pressable>
          <Text style={[styles.body, { flex: 1 }, i.checked ? { textDecorationLine: "line-through", color: colors.muted } : null]}>
            {i.name}
            {i.quantity ? <Text style={styles.muted}>{`  ${i.quantity}`}</Text> : null}
          </Text>
          <Pressable
            onPress={async () => {
              await removeFromList([i.id]);
              load();
            }}
            hitSlop={8}
            accessibilityLabel={`Remove ${i.name}`}
          >
            <Text style={{ color: colors.muted, fontSize: 18 }}>×</Text>
          </Pressable>
        </Row>
      ))}
      {checked.length ? (
        <Row style={{ gap: 8, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <Button small label={`Bought: add ${checked.length} to pantry`} onPress={moveToPantry} loading={busy} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              small
              kind="secondary"
              label="Clear checked"
              onPress={async () => {
                await removeFromList(checked.map((i) => i.id));
                load();
              }}
              disabled={busy}
            />
          </View>
        </Row>
      ) : null}
    </Card>
  );
}
