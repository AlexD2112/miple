import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, Screen, Title, colors, styles } from "@/components/ui";
import { logMealToHealth } from "@/lib/health";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import type { MealSlot, RecipeStep } from "@/lib/types";
import { stepText } from "@/lib/types";

interface GuideStep {
  phase: "prep" | "cook";
  text: string;
  timer: number | null;
}

const PREP = /\b(chop|dice|mince|slice|wash|peel|measure|preheat|grate|whisk)\b/i;

function minutesIn(text: string): number | null {
  const match = text.match(/(\d+)\s*(?:min|mins|minute|minutes)\b/i);
  return match ? Number(match[1]) : null;
}

function toGuide(steps: RecipeStep[]): GuideStep[] {
  return steps.map((step) => {
    const text = stepText(step);
    const phase = typeof step === "string" ? (PREP.test(text) ? "prep" : "cook") : step.phase === "prep" ? "prep" : "cook";
    const timer = typeof step === "string" ? minutesIn(text) : (step.timer_minutes ?? minutesIn(text));
    return { phase, text, timer };
  });
}

export default function Cook() {
  const { slot: slotId } = useLocalSearchParams<{ slot: string }>();
  const { profile } = useProfile();
  const [slot, setSlot] = useState<MealSlot | null>(null);
  const [index, setIndex] = useState(0);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!slotId) return;
    supabase
      .from("meal_slots")
      .select("*, recipes(*)")
      .eq("id", slotId)
      .maybeSingle()
      .then(({ data }) => setSlot((data ?? null) as MealSlot | null));
  }, [slotId]);

  useEffect(() => {
    if (!endsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [endsAt]);

  const guide = useMemo(() => toGuide(slot?.recipes?.steps ?? []), [slot]);
  const step = guide[index];
  const remaining = endsAt ? Math.max(0, Math.ceil((endsAt - now) / 1000)) : 0;

  async function finish() {
    if (!slot) return;
    const { error } = await supabase.rpc("cook_meal_slot", { p_slot_id: slot.id });
    if (error) return;
    if (profile?.healthkit_enabled && slot.recipes) {
      if (await logMealToHealth(slot.recipes)) {
        await supabase.from("meal_slots").update({ logged_to_health: true }).eq("id", slot.id);
      }
    }
    setDone(true);
  }

  return (
    <Screen>
      <Pressable onPress={() => router.back()} style={{ marginBottom: 8 }}>
        <Text style={{ color: colors.brand, fontWeight: "700" }}>← Plan</Text>
      </Pressable>
      <Title sub={slot?.recipes ? `${slot.recipes.minutes} min` : "Loading"}>{slot?.recipes?.title ?? "Recipe"}</Title>

      {done ? (
        <Card>
          <Text style={styles.h2}>That's dinner.</Text>
          <Text style={styles.body}>The meal is marked cooked.</Text>
          <View style={{ height: 12 }} />
          <Button label="Back to plan" onPress={() => router.back()} />
        </Card>
      ) : step ? (
        <Card>
          <Text style={styles.muted}>
            {step.phase === "prep" ? "Prep" : "Cook"} · {index + 1} of {guide.length}
          </Text>
          <Text style={[styles.h2, { marginTop: 8, fontSize: 22 }]}>{step.text}</Text>
          {step.timer ? (
            <View style={{ marginTop: 16 }}>
              <Text style={{ fontSize: 42, fontWeight: "800", color: colors.text }}>
                {endsAt ? formatClock(remaining) : `${step.timer}:00`}
              </Text>
              <View style={{ height: 8 }} />
              {endsAt ? (
                <Button kind="secondary" label={remaining === 0 ? "Timer done" : "Stop timer"} onPress={() => setEndsAt(null)} />
              ) : (
                <Button label={`Start ${step.timer} min`} onPress={() => setEndsAt(Date.now() + step.timer! * 60_000)} />
              )}
            </View>
          ) : null}
          <View style={{ flexDirection: "row", gap: 8, marginTop: 18 }}>
            <View style={{ flex: 1 }}>
              <Button
                kind="secondary"
                label="Back"
                onPress={() => {
                  setEndsAt(null);
                  setIndex((n) => Math.max(0, n - 1));
                }}
                disabled={index === 0}
              />
            </View>
            <View style={{ flex: 1 }}>
              {index < guide.length - 1 ? (
                <Button
                  label="Next"
                  onPress={() => {
                    setEndsAt(null);
                    setIndex((n) => n + 1);
                  }}
                />
              ) : (
                <Button label="Done cooking" onPress={finish} />
              )}
            </View>
          </View>
        </Card>
      ) : (
        <Card>
          <Text style={styles.body}>This meal has no steps yet.</Text>
        </Card>
      )}
    </Screen>
  );
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
