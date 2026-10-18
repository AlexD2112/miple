import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View, type LayoutChangeEvent } from "react-native";
import { Button, Card, Chip, Field, Row, colors, styles } from "@/components/ui";
import { DEFAULT_GOAL, loadGoal, modeOf, recommend, saveGoal, type GoalMode, type Recommendation, type WeightGoal } from "@/lib/adaptive";
import { getDailyIntake, getWeightHistory, logWeight, weightTrend, type WeightEntry } from "@/lib/health";
import type { Profile } from "@/lib/types";

const RATES = [0.25, 0.5, 0.75, 1];
const MODES: { mode: GoalMode; label: string }[] = [
  { mode: "lose", label: "Lose" },
  { mode: "maintain", label: "Maintain" },
  { mode: "bulk", label: "Bulk" },
];
const RANGES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
];
const CHART_H = 150;

/** Weigh-ins, goal and the adaptive recommendation, shared by the weight card and the targets card. */
export function useWeight(profile: Profile) {
  const [days, setDays] = useState(30);
  const [weights, setWeights] = useState<WeightEntry[]>([]);
  const [goal, setGoal] = useState<WeightGoal>(DEFAULT_GOAL);
  const [rec, setRec] = useState<Recommendation | null>(null);

  const refresh = useCallback(
    async (g?: WeightGoal, d = days) => {
      const useGoal = g ?? (await loadGoal());
      // The recommendation always looks at the last 30 days; the chart can show more.
      const [shown, recent, intake] = await Promise.all([
        getWeightHistory(profile, d),
        d === 30 ? Promise.resolve(null) : getWeightHistory(profile, 30),
        getDailyIntake(profile, 21),
      ]);
      setWeights(shown);
      setGoal(useGoal);
      setRec(recommend(profile, recent ?? shown, intake, useGoal));
    },
    [profile, days],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    weights,
    goal,
    rec,
    days,
    setDays,
    log: async (lb: number) => {
      await logWeight(profile, lb);
      await refresh(goal);
    },
    updateGoal: async (patch: Partial<WeightGoal>) => {
      const next = { ...goal, ...patch };
      await saveGoal(next);
      await refresh(next);
    },
  };
}

export type WeightState = ReturnType<typeof useWeight>;

/** MacroFactor-style weight card: scale weigh-ins as dots, the smoothed trend as a line, goal and pace. */
export function WeightCard({ w }: { w: WeightState }) {
  const [entry, setEntry] = useState("");
  const [goalText, setGoalText] = useState(w.goal.goalLb ? String(w.goal.goalLb) : "");
  const [busy, setBusy] = useState(false);

  useEffect(() => setGoalText(w.goal.goalLb ? String(w.goal.goalLb) : ""), [w.goal.goalLb]);

  async function addWeight() {
    const lb = parseFloat(entry);
    if (!lb || lb < 50 || lb > 700) return Alert.alert("Enter your weight in lb");
    setBusy(true);
    await w.log(lb);
    setEntry("");
    setBusy(false);
  }

  const trend = w.rec?.trendLbPerWeek;

  return (
    <Card>
      <Row style={{ justifyContent: "space-between", alignItems: "flex-end", marginBottom: 4 }}>
        <Text style={styles.h2}>Weight trend</Text>
        <Row style={{ gap: 6 }}>
          {RANGES.map((r) => (
            <Chip key={r.label} label={r.label} selected={w.days === r.days} onPress={() => w.setDays(r.days)} />
          ))}
        </Row>
      </Row>
      <Row style={{ alignItems: "flex-end", gap: 10 }}>
        <Text style={styles.statValue}>
          {w.rec?.currentLb ? w.rec.currentLb.toFixed(1) : "—"}
          <Text style={styles.statUnit}> lb</Text>
        </Text>
        {trend != null ? (
          <Text style={[styles.muted, { marginBottom: 6, color: trend <= 0 ? colors.brand : colors.muted }]}>
            {trend >= 0 ? "+" : ""}
            {trend.toFixed(1)} lb/week
          </Text>
        ) : null}
      </Row>

      <WeightChart weights={w.weights} goalLb={w.goal.goalLb} />

      <Row style={{ gap: 8, alignItems: "flex-end" }}>
        <View style={{ flex: 1 }}>
          <Field label="Today's weight (lb)" keyboardType="decimal-pad" value={entry} onChangeText={setEntry} placeholder="e.g. 172.4" />
        </View>
        <View style={{ marginBottom: 14 }}>
          <Button small label="Log" onPress={addWeight} loading={busy} disabled={!entry.trim()} />
        </View>
      </Row>

      <Text style={styles.label}>Goal</Text>
      <Row style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {MODES.map((m) => (
          <Chip
            key={m.mode}
            label={m.label}
            selected={modeOf(w.goal, w.rec?.currentLb ?? null) === m.mode}
            onPress={() => w.updateGoal({ mode: m.mode })}
          />
        ))}
      </Row>

      <Field
        label="Goal weight (lb, optional)"
        keyboardType="decimal-pad"
        value={goalText}
        onChangeText={setGoalText}
        onEndEditing={() => {
          // A goal weight above or below today's sets the direction, as it did before the mode chips existed.
          const goalLb = parseFloat(goalText) || null;
          const current = w.rec?.currentLb ?? null;
          const patch: Partial<WeightGoal> = { goalLb };
          if (goalLb && current && Math.abs(goalLb - current) >= 1) patch.mode = goalLb < current ? "lose" : "bulk";
          w.updateGoal(patch);
        }}
        placeholder="e.g. 165"
      />
      {modeOf(w.goal, w.rec?.currentLb ?? null) !== "maintain" ? (
        <>
          <Text style={styles.label}>Pace (lb per week)</Text>
          <Row style={{ gap: 8, flexWrap: "wrap" }}>
            {RATES.map((r) => (
              <Chip key={r} label={String(r)} selected={w.goal.ratePerWeek === r} onPress={() => w.updateGoal({ ratePerWeek: r })} />
            ))}
          </Row>
        </>
      ) : null}
    </Card>
  );
}

/** Dots for weigh-ins, a smoothed trend line and a dashed goal line. Built from Views, no chart library. */
function WeightChart({ weights, goalLb }: { weights: WeightEntry[]; goalLb: number | null }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  if (weights.length < 2) {
    return (
      <View style={{ height: 90, justifyContent: "center", alignItems: "center" }}>
        <Text style={styles.muted}>Log a couple of weigh-ins to see your trend.</Text>
      </View>
    );
  }

  const trend = weightTrend(weights);
  const values = [...weights.map((x) => x.lb), ...trend, ...(goalLb ? [goalLb] : [])];
  const min = Math.floor(Math.min(...values) - 1);
  const max = Math.ceil(Math.max(...values) + 1);
  const AXIS = 34;
  const plotW = Math.max(1, width - AXIS);
  const t0 = new Date(weights[0].date).getTime();
  const span = Math.max(1, new Date(weights[weights.length - 1].date).getTime() - t0);
  const x = (d: string) => ((new Date(d).getTime() - t0) / span) * (plotW - 8) + 4;
  const y = (lb: number) => CHART_H - ((lb - min) / (max - min)) * CHART_H;
  const mid = Math.round((min + max) / 2);

  const segments = trend.slice(1).map((v, i) => {
    const x1 = x(weights[i].date);
    const y1 = y(trend[i]);
    const x2 = x(weights[i + 1].date);
    const y2 = y(v);
    const len = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    return (
      <View
        key={`s${i}`}
        style={{
          position: "absolute",
          left: (x1 + x2) / 2 - len / 2,
          top: (y1 + y2) / 2 - 1.5,
          width: len,
          height: 3,
          borderRadius: 2,
          backgroundColor: colors.brand,
          transform: [{ rotate: `${angle}rad` }],
        }}
      />
    );
  });

  return (
    <View style={{ marginVertical: 12 }}>
      <View onLayout={onLayout} style={{ height: CHART_H, flexDirection: "row" }}>
        {width > 0 ? (
          <>
            <View style={{ width: plotW, height: CHART_H }}>
              {[max, mid, min].map((v) => (
                <View key={v} style={{ position: "absolute", left: 0, right: 0, top: y(v), borderTopWidth: 1, borderColor: colors.border }} />
              ))}
              {goalLb ? (
                <View style={{ position: "absolute", left: 0, right: 0, top: y(goalLb), borderTopWidth: 1.5, borderStyle: "dashed", borderColor: colors.muted }} />
              ) : null}
              {weights.map((p, i) => (
                <View
                  key={`d${i}`}
                  style={{ position: "absolute", left: x(p.date) - 3, top: y(p.lb) - 3, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted, opacity: 0.5 }}
                />
              ))}
              {segments}
            </View>
            <View style={{ width: AXIS, height: CHART_H }}>
              {[max, mid, min].map((v) => (
                <Text key={v} style={[styles.label, { position: "absolute", right: 0, top: y(v) - 9, marginBottom: 0 }]}>
                  {v}
                </Text>
              ))}
            </View>
          </>
        ) : null}
      </View>
      <Row style={{ justifyContent: "space-between", marginTop: 6, paddingRight: AXIS }}>
        <Text style={styles.label}>{new Date(weights[0].date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</Text>
        {goalLb ? <Text style={styles.label}>- - goal {goalLb} lb</Text> : null}
        <Text style={styles.label}>Today</Text>
      </Row>
    </View>
  );
}
