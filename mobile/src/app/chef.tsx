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
import { Button, Card, Chip, Screen, Title, colors, styles } from "@/components/ui";
import { applyChefProposal, chatWithChef, type ChefProposal } from "@/lib/api";
import { addMealToCalendar, addShoppingToCalendar, defaultShoppingTime, findFreeMealWindows } from "@/lib/calendar";
import { daysUntil } from "@/lib/dates";
import { getRemainingMacros } from "@/lib/health";
import { useProfile } from "@/lib/profile";
import { mealNotes, planOpenWindows } from "@/lib/schedule";
import { supabase } from "@/lib/supabase";
import type { Item, MealSlot } from "@/lib/types";
import { useFocusData } from "@/lib/useFocusData";

const SUGGESTIONS = ["I want shakshuka tonight", "Use what's expiring first", "Skip tomorrow's lunch"];

interface ChatMessage {
  role: "user" | "chef";
  text: string;
}

export default function Chef() {
  const { profile } = useProfile();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [proposal, setProposal] = useState<ChefProposal | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "chef",
      text: "Tell me what you want to eat. I'll check the pantry, tell you what to buy or substitute, and wait for you to approve before I change the plan.",
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
    setProposal(null);
    setSending(true);
    try {
      const planned = data.slots.filter((s) => s.recipes);
      const windows = await findFreeMealWindows(3);
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
        now: new Date().toISOString(),
        windows: windows.map((w) => ({
          start: w.start.toISOString(),
          end: w.end.toISOString(),
          minutes: w.minutes,
          meal: w.meal,
        })),
      });
      setMessages([...history, { role: "chef", text: result.message }]);
      setProposal(result.proposal);
    } catch (err) {
      setMessages(history);
      Alert.alert("Chef is unavailable", err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  async function approve(next: ChefProposal) {
    if (!data || sending) return;
    setSending(true);
    try {
      const result = await applyChefProposal(next);
      if (result.slot_id && result.title) {
        const { data: row } = await supabase.from("meal_slots").select("*, recipes(*)").eq("id", result.slot_id).maybeSingle();
        const recipe = (row as MealSlot | null)?.recipes;
        if (recipe) {
          const eventId = await addMealToCalendar(
            result.title,
            new Date(result.starts_at),
            new Date(result.ends_at),
            mealNotes(recipe),
            result.calendar_event_id,
          );
          if (eventId) await supabase.from("meal_slots").update({ calendar_event_id: eventId }).eq("id", result.slot_id);
        }
        if (result.shopping_items.length > 0) {
          const when =
            result.shopping_at && !Number.isNaN(Date.parse(result.shopping_at))
              ? new Date(result.shopping_at)
              : defaultShoppingTime(new Date(result.starts_at));
          const shopId = await addShoppingToCalendar(result.title, when, result.shopping_items);
          if (shopId) {
            const saved = await supabase.from("meal_slots").update({ shopping_event_id: shopId }).eq("id", result.slot_id);
            if (saved.error) console.warn(saved.error.message);
          }
        }
      }
      if (result.rebuild_week) {
        await planOpenWindows({ remaining: data.macros.remaining, target: data.macros.target });
      }
      setProposal(null);
      setMessages((current) => [
        ...current,
        {
          role: "chef",
          text: result.title
            ? `${result.title} is on your plan and your calendar.${result.shopping_items.length ? " I also blocked time to shop." : ""}`
            : "Skipped that meal.",
        },
      ]);
      reload();
    } catch (err) {
      Alert.alert("Couldn't update the plan", err instanceof Error ? err.message : String(err));
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
          <Title sub="Ask for a dish. Nothing changes until you approve.">Your chef</Title>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
            {planned.length === 0 ? null : (
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
            {proposal ? <ProposalCard proposal={proposal} disabled={sending} onApprove={() => approve(proposal)} onDismiss={() => setProposal(null)} /> : null}
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
              placeholder="I want shakshuka tonight"
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

function ProposalCard({
  proposal,
  disabled,
  onApprove,
  onDismiss,
}: {
  proposal: ChefProposal;
  disabled: boolean;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const when = new Date(proposal.starts_at);
  const groups = [
    ["have", "You have"],
    ["substitute", "Substitute"],
    ["need", "Buy"],
  ] as const;
  return (
    <Card>
      <Text style={styles.h2}>{proposal.recipe?.title ?? "Skip this meal"}</Text>
      <Text style={styles.muted}>
        {when.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}
        {proposal.rebuild_week ? " · I'll refill the rest of the week" : ""}
      </Text>
      {groups.map(([status, label]) => {
        const rows = proposal.gaps.filter((gap) => gap.status === status);
        if (rows.length === 0) return null;
        return (
          <View key={status} style={{ marginTop: 8 }}>
            <Text style={styles.label}>{label}</Text>
            {rows.map((gap, n) => (
              <Text key={n} style={styles.body}>
                • {gap.quantity} {gap.name}
                {gap.substitute ? ` → ${gap.substitute}` : ""}
                {gap.note ? ` (${gap.note})` : ""}
              </Text>
            ))}
          </View>
        );
      })}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Button kind="secondary" label="Not now" onPress={onDismiss} disabled={disabled} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Approve" onPress={onApprove} disabled={disabled} />
        </View>
      </View>
    </Card>
  );
}
