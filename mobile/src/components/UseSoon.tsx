import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, Pill, Row, colors, styles } from "@/components/ui";
import { daysUntil, expiryLabel } from "@/lib/dates";
import { supabase } from "@/lib/supabase";
import type { Item, Recipe } from "@/lib/types";

/** How many days out counts as "use soon". */
const SOON_DAYS = 3;

interface Match {
  recipe: Recipe;
  uses: string[];
  slotId: string | null;
  when: string | null;
}

/**
 * Top of the Pantry: items about to go bad, and recipes that use them
 * (planned meals first, then recent recipes), so the next step is one tap away.
 */
export function UseSoon({ items }: { items: Item[] }) {
  const soon = items.filter((i) => daysUntil(i.estimated_expiry) <= SOON_DAYS);
  const key = soon.map((i) => i.id).join(",");
  const [matches, setMatches] = useState<Match[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (soon.length === 0) {
        setMatches([]);
        return;
      }
      let cancelled = false;
      (async () => {
        const since = new Date();
        since.setHours(0, 0, 0, 0);
        const [{ data: slots }, { data: recent }] = await Promise.all([
          supabase
            .from("meal_slots")
            .select("id, starts_at, recipes(*)")
            .eq("status", "planned")
            .gte("starts_at", since.toISOString())
            .order("starts_at"),
          supabase.from("recipes").select("*").order("created_at", { ascending: false }).limit(30),
        ]);
        if (cancelled) return;

        const names = soon.map((i) => i.name.toLowerCase());
        const usesOf = (r: Recipe) =>
          soon
            .filter(
              (it, idx) =>
                r.ingredients.some((ing) => ing.item_id === it.id) ||
                r.ingredients.some((ing) => {
                  const n = ing.name.toLowerCase();
                  return n.includes(names[idx]) || names[idx].includes(n);
                }),
            )
            .map((it) => it.name);

        const seen = new Set<string>();
        const out: Match[] = [];
        for (const s of (slots ?? []) as unknown as { id: string; starts_at: string; recipes: Recipe | null }[]) {
          if (!s.recipes || seen.has(s.recipes.id)) continue;
          const uses = usesOf(s.recipes);
          if (uses.length === 0) continue;
          seen.add(s.recipes.id);
          out.push({ recipe: s.recipes, uses, slotId: s.id, when: s.starts_at });
        }
        for (const r of (recent ?? []) as Recipe[]) {
          if (seen.has(r.id)) continue;
          const uses = usesOf(r);
          if (uses.length === 0) continue;
          seen.add(r.id);
          out.push({ recipe: r, uses, slotId: null, when: null });
        }
        out.sort((a, b) => Number(!!b.slotId) - Number(!!a.slotId) || b.uses.length - a.uses.length);
        setMatches(out.slice(0, 3));
      })().catch(() => setMatches([]));
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]),
  );

  if (soon.length === 0) return null;

  const askChef = () =>
    router.push({
      pathname: "/chef",
      params: { q: `Give me a recipe that uses ${soon.slice(0, 4).map((i) => i.name).join(", ")} before they go bad` },
    });

  return (
    <Card style={{ borderWidth: 1, borderColor: colors.warn }}>
      <Row style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <Text style={styles.h2}>Use soon</Text>
        <Text style={styles.muted}>
          {soon.length} item{soon.length > 1 ? "s" : ""}
        </Text>
      </Row>

      {soon.slice(0, 5).map((i) => {
        const n = daysUntil(i.estimated_expiry);
        return (
          <Row key={i.id} style={{ justifyContent: "space-between", alignItems: "center", paddingVertical: 4 }}>
            <Text style={[styles.body, { flex: 1 }]} numberOfLines={1}>
              {i.name}
            </Text>
            <Pill label={expiryLabel(i.estimated_expiry)} tone={n <= 1 ? "danger" : "warn"} />
          </Row>
        );
      })}
      {soon.length > 5 ? <Text style={styles.muted}>+{soon.length - 5} more below</Text> : null}

      <Text style={[styles.label, { marginTop: 12 }]}>RECIPES THAT USE THEM</Text>
      {matches === null ? (
        <Text style={styles.muted}>Finding recipes…</Text>
      ) : matches.length === 0 ? (
        <Text style={[styles.muted, { marginBottom: 8 }]}>No saved recipes use these yet.</Text>
      ) : (
        matches.map((m) => (
          <Pressable
            key={m.recipe.id}
            onPress={() =>
              m.slotId
                ? router.push({ pathname: "/cook", params: { slot: m.slotId } })
                : router.push({ pathname: "/chef", params: { q: `Plan ${m.recipe.title} tonight` } })
            }
            style={({ pressed }) => ({
              backgroundColor: colors.bg,
              borderRadius: 12,
              padding: 12,
              marginBottom: 8,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Row style={{ justifyContent: "space-between", alignItems: "center" }}>
              <Text style={[styles.body, { fontWeight: "600", flex: 1, marginRight: 8 }]} numberOfLines={1}>
                {m.recipe.title}
              </Text>
              {m.when ? (
                <Pill label={new Date(m.when).toLocaleDateString(undefined, { weekday: "short" })} tone="good" />
              ) : (
                <Text style={styles.muted}>{m.recipe.minutes} min</Text>
              )}
            </Row>
            <Text style={styles.muted} numberOfLines={1}>
              Uses {m.uses.join(", ")} · {m.recipe.calories} kcal · P {m.recipe.protein_g}g
            </Text>
          </Pressable>
        ))
      )}
      <View style={{ marginTop: 4 }}>
        <Button kind="secondary" label="Ask the chef for ideas" onPress={askChef} />
      </View>
    </Card>
  );
}
