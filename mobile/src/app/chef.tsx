import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Chip, Screen, Title, colors, styles } from "@/components/ui";
import { chatWithChef } from "@/lib/api";
import { daysUntil } from "@/lib/dates";
import { getRemainingMacros } from "@/lib/health";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import type { Item, MealSlot } from "@/lib/types";
import { useFocusData } from "@/lib/useFocusData";

const SUGGESTIONS = ["Use what's expiring first", "Make dinner faster", "Skip tomorrow's lunch"];

interface ChatMessage {
  role: "user" | "chef";
  text: string;
}

export default function Chef() {
  const { profile } = useProfile();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "chef",
      text: "Tell me what to change. I can swap a planned meal or skip one.",
    },
  ]);

  const [data, reload] = useFocusData(async () => {
    if (!profile) return null;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const [macros, slots, items] = await Promise.all([
      getRemainingMacros(profile),
      supabase
        .from("meal_slots")
        .select("*, recipes(*)")
        .gte("starts_at", since.toISOString())
        .eq("status", "planned")
        .order("starts_at"),
      supabase.from("items").select("*").eq("status", "active"),
    ]);
    return {
      macros,
      slots: (slots.data ?? []) as MealSlot[],
      pantry: (items.data ?? []) as Item[],
    };
  }, [profile]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !profile || !data || sending) return;
    const history = [...messages, { role: "user" as const, text: trimmed }];
    setMessages(history);
    setDraft("");
    setSending(true);
    try {
      const planned = data.slots.filter((s) => s.recipes);
      const result = await chatWithChef({
        messages: history.slice(1).slice(-12),
        plan: planned.map((slot) => ({
          slot_id: slot.id,
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
          minutes_available: Math.max(
            5,
            Math.round((new Date(slot.ends_at).getTime() - new Date(slot.starts_at).getTime()) / 60000),
          ),
          title: slot.recipes!.title,
          minutes: slot.recipes!.minutes,
          calories: slot.recipes!.calories,
          protein_g: slot.recipes!.protein_g,
          carbs_g: slot.recipes!.carbs_g,
          fat_g: slot.recipes!.fat_g,
          ingredients: slot.recipes!.ingredients.map((i) => `${i.quantity} ${i.name}`),
        })),
        pantry: data.pantry.map((i) => ({
          id: i.id,
          name: i.name,
          category: i.category,
          quantity: Number(i.quantity),
          unit: i.unit,
          days_left: daysUntil(i.estimated_expiry),
        })),
        remaining: data.macros.remaining,
      });
      const note =
        result.applied.length > 0
          ? `\n\n${result.applied
              .map((a) => (a.action === "skip" ? `Skipped ${a.title ?? "a meal"}` : `Updated ${a.title ?? "a meal"}`))
              .join("\n")}`
          : "";
      setMessages([...history, { role: "chef", text: `${result.message}${note}` }]);
      if (result.applied.length > 0) reload();
    } catch (err) {
      setMessages(history);
      Alert.alert("Chef is unavailable", err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const planned = (data?.slots ?? []).filter((s) => s.recipes);

  return (
    <Screen scroll={false}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
      >
        <View style={{ flex: 1, padding: 16, paddingBottom: Math.max(insets.bottom, 12) }}>
          <Pressable onPress={() => router.back()} style={{ marginBottom: 8 }}>
            <Text style={{ color: colors.brand, fontWeight: "700" }}>← Plan</Text>
          </Pressable>
          <Title sub="Adjust the meals already on your plan">Your chef</Title>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
            {planned.length === 0 ? (
              <Card>
                <Text style={styles.body}>No planned meals yet. Plan meals first, then come back to tweak them.</Text>
              </Card>
            ) : (
              <Card>
                {planned.map((slot) => (
                  <Text key={slot.id} style={[styles.body, { marginBottom: 4 }]}>
                    {new Date(slot.starts_at).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
                    {" · "}
                    {slot.recipes?.title}
                  </Text>
                ))}
              </Card>
            )}

            {messages.map((m, i) => (
              <View
                key={i}
                style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "88%",
                  backgroundColor: m.role === "user" ? colors.brand : colors.card,
                  borderRadius: 14,
                  padding: 12,
                  marginBottom: 8,
                  borderWidth: m.role === "chef" ? 1 : 0,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: m.role === "user" ? "#fff" : colors.text, fontSize: 15 }}>{m.text}</Text>
              </View>
            ))}
            {sending ? <ActivityIndicator color={colors.brand} style={{ alignSelf: "flex-start" }} /> : null}
          </ScrollView>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 8 }}>
            {SUGGESTIONS.map((s) => (
              <View key={s} style={{ marginRight: 8 }}>
                <Chip label={s} onPress={() => send(s)} />
              </View>
            ))}
          </ScrollView>

          <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Make Thursday dinner vegetarian"
              placeholderTextColor={colors.muted}
              style={[styles.input, { flex: 1, maxHeight: 100 }]}
              multiline
              editable={!sending}
            />
            <Pressable
              onPress={() => send(draft)}
              disabled={sending || !draft.trim()}
              style={{
                backgroundColor: colors.brand,
                borderRadius: 12,
                paddingHorizontal: 14,
                paddingVertical: 12,
                opacity: sending || !draft.trim() ? 0.5 : 1,
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "700" }}>Send</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
