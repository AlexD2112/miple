import { Share, Text, View } from "react-native";
import { useState } from "react";
import { BuyNext } from "@/components/BuyNext";
import { ShoppingList } from "@/components/ShoppingList";
import { Button, Card, Row, Screen, Title, colors, styles } from "@/components/ui";
import { localIsoDate, startOfWeek } from "@/lib/dates";
import { supabase } from "@/lib/supabase";
import type { Item, Receipt } from "@/lib/types";
import { useFocusData } from "@/lib/useFocusData";

interface WeeklyStats {
  spent: number;
  items_saved: number;
  items_wasted: number;
}

export default function Budget() {
  const [listKey, setListKey] = useState(0);
  const [data] = useFocusData(async () => {
    const weekStart = localIsoDate(startOfWeek());
    const [stats, receipts, items] = await Promise.all([
      supabase.from("weekly_stats").select("spent, items_saved, items_wasted").maybeSingle(),
      supabase.from("receipts").select("*").gte("purchased_at", weekStart).order("purchased_at", { ascending: false }),
      supabase.from("items").select("category, price").gte("purchase_date", weekStart),
    ]);

    const byCategory = new Map<string, number>();
    for (const i of (items.data ?? []) as Pick<Item, "category" | "price">[]) {
      byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + Number(i.price ?? 0));
    }
    return {
      stats: (stats.data ?? { spent: 0, items_saved: 0, items_wasted: 0 }) as WeeklyStats,
      receipts: (receipts.data ?? []) as Receipt[],
      categories: [...byCategory.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]),
    };
  });

  const stats = data?.stats ?? { spent: 0, items_saved: 0, items_wasted: 0 };
  const spent = Number(stats.spent);
  const max = Math.max(1, ...(data?.categories ?? []).map(([, v]) => v));

  function share() {
    Share.share({
      message: `My Ripe week: $${spent.toFixed(0)} spent, ${stats.items_saved} items saved, ${stats.items_wasted} wasted. 🥬`,
    });
  }

  return (
    <Screen>
      <Title sub="Your list, what to buy next, and what you spent">Groceries</Title>

      <ShoppingList refreshKey={listKey} />

      <BuyNext onListChanged={() => setListKey((k) => k + 1)} />

      {/* Wrapped card */}
      <View style={{ backgroundColor: colors.brand, borderRadius: 20, padding: 20, marginBottom: 12 }}>
        <Text style={{ color: "#DDEFD0", fontWeight: "700", letterSpacing: 1 }}>RIPE WRAPPED · THIS WEEK</Text>
        <Text style={{ color: "#fff", fontSize: 40, fontWeight: "900", marginTop: 8 }}>${spent.toFixed(0)}</Text>
        <Text style={{ color: "#DDEFD0" }}>spent on groceries</Text>
        <Row style={{ marginTop: 16, gap: 24 }}>
          <Stat n={stats.items_saved} label="items saved" />
          <Stat n={stats.items_wasted} label="wasted" />
        </Row>
        <View style={{ marginTop: 16 }}>
          <Button kind="secondary" label="Share" onPress={share} />
        </View>
      </View>

      <Card>
        <Text style={styles.h2}>By category</Text>
        {(data?.categories ?? []).map(([cat, total]) => (
          <View key={cat} style={{ marginBottom: 8 }}>
            <Row style={{ justifyContent: "space-between" }}>
              <Text style={styles.body}>{cat.replace(/_/g, " ")}</Text>
              <Text style={styles.body}>${total.toFixed(2)}</Text>
            </Row>
            <View style={{ height: 6, backgroundColor: colors.brandSoft, borderRadius: 3, marginTop: 3 }}>
              <View style={{ height: 6, width: `${(total / max) * 100}%`, backgroundColor: colors.brand, borderRadius: 3 }} />
            </View>
          </View>
        ))}
        {data && data.categories.length === 0 ? <Text style={styles.muted}>No priced items yet this week.</Text> : null}
      </Card>

      <Card>
        <Text style={styles.h2}>Receipts</Text>
        {(data?.receipts ?? []).map((r) => (
          <Row key={r.id} style={{ justifyContent: "space-between", paddingVertical: 4 }}>
            <Text style={styles.body}>
              {r.store ?? "Receipt"} · {r.purchased_at}
            </Text>
            <Text style={styles.body}>{r.total != null ? `$${Number(r.total).toFixed(2)}` : "–"}</Text>
          </Row>
        ))}
        {data && data.receipts.length === 0 ? <Text style={styles.muted}>No receipts this week.</Text> : null}
      </Card>
    </Screen>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <View>
      <Text style={{ color: "#fff", fontSize: 28, fontWeight: "800" }}>{n}</Text>
      <Text style={{ color: "#DDEFD0" }}>{label}</Text>
    </View>
  );
}
