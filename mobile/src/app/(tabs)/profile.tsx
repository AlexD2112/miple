import { useEffect, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";
import { Button, Card, Field, Row, Screen, Title, colors, styles } from "@/components/ui";
import { AllergyInput, DietPicker } from "@/components/Preferences";
import { WeightCard, useWeight } from "@/components/WeightCard";
import { isHealthKitSupported, lastHealthError, requestHealthPermissions } from "@/lib/health";
import { useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";
import type { Profile } from "@/lib/types";

export default function ProfileScreen() {
  const { profile } = useProfile();
  if (!profile) {
    return (
      <Screen>
        <Title>Me</Title>
        <Button kind="secondary" label="Sign out" onPress={() => supabase.auth.signOut()} />
      </Screen>
    );
  }
  // Remount the form when the saved profile changes so the draft resets.
  return <ProfileForm key={JSON.stringify(profile)} profile={profile} />;
}

function ProfileForm({ profile }: { profile: Profile }) {
  const { save } = useProfile();
  const [draft, setDraft] = useState<Profile>(profile);
  const [dislikes, setDislikes] = useState(profile.dislikes.join(", "));
  const w = useWeight(profile);
  const rec = w.rec;
  const auto = w.goal.auto;
  const shown = auto && rec
    ? { calorie_target: rec.calories, protein_target_g: rec.protein_g, carbs_target_g: rec.carbs_g, fat_target_g: rec.fat_g }
    : { calorie_target: draft.calorie_target, protein_target_g: draft.protein_target_g, carbs_target_g: draft.carbs_target_g, fat_target_g: draft.fat_target_g };

  // In Auto mode, keep the saved targets in step with the recommendation (like MacroFactor's weekly check-in).
  useEffect(() => {
    if (!auto || !rec || !rec.currentLb) return;
    const changed =
      rec.calories !== profile.calorie_target ||
      rec.protein_g !== profile.protein_target_g ||
      rec.carbs_g !== profile.carbs_target_g ||
      rec.fat_g !== profile.fat_target_g;
    if (changed) {
      save({ calorie_target: rec.calories, protein_target_g: rec.protein_g, carbs_target_g: rec.carbs_g, fat_target_g: rec.fat_g }).catch(() => {});
    }
  }, [auto, rec]); // eslint-disable-line react-hooks/exhaustive-deps
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<Profile>) => setDraft({ ...draft, ...patch });
  const num = (v: string) => Math.max(0, parseInt(v.replace(/\D/g, ""), 10) || 0);

  async function toggleHealth(on: boolean) {
    if (on && !(await requestHealthPermissions())) {
      return Alert.alert(
        "Apple Health unavailable",
        `${lastHealthError ?? "Unknown error."}\n\nRipe will use your manual targets instead.`,
      );
    }
    set({ healthkit_enabled: on });
  }

  async function onSave() {
    setSaving(true);
    try {
      await save({
        diet: draft.diet.trim().toLowerCase() || "omnivore",
        allergies: draft.allergies,
        dislikes: dislikes.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean),
        ...shown,
        phone: draft.phone?.trim() || null,
        nudges_enabled: draft.nudges_enabled,
        allow_staples: draft.allow_staples ?? false,
        healthkit_enabled: draft.healthkit_enabled,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      Alert.alert("Saved");
    } catch (err) {
      Alert.alert("Save failed", String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <Title>Me</Title>

      <WeightCard w={w} />

      <Card>
        <DietPicker value={draft.diet} onChange={(diet) => set({ diet })} />
      </Card>

      <Card>
        <Text style={styles.h2}>Allergies</Text>
        <Text style={[styles.muted, { marginBottom: 10 }]}>Recipes containing these are always filtered out.</Text>
        <AllergyInput value={draft.allergies} onChange={(allergies) => set({ allergies })} />
        <View style={{ height: 14 }} />
        <Field label="Dislikes (comma separated)" value={dislikes} onChangeText={setDislikes} placeholder="cilantro, olives" />
      </Card>

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={styles.h2}>Daily targets</Text>
          <Row style={{ gap: 8 }}>
            <Text style={styles.muted}>Auto</Text>
            <Switch value={auto} onValueChange={(v) => w.updateGoal({ auto: v })} trackColor={{ true: colors.brand }} />
          </Row>
        </Row>
        {auto ? (
          <Text style={[styles.muted, { marginBottom: 10 }]}>
            {rec
              ? `You burn about ${rec.expenditure} kcal a day. Goal: ${rec.direction === "maintain" ? "maintain" : rec.direction === "lose" ? "lose weight" : "bulk"}. ${rec.reason}`
              : "Working out your targets…"}
          </Text>
        ) : null}
        <Row>
          <Field label="Calories" editable={!auto} keyboardType="number-pad" value={String(shown.calorie_target)} onChangeText={(v) => set({ calorie_target: num(v) })} />
          <Field label="Protein g" editable={!auto} keyboardType="number-pad" value={String(shown.protein_target_g)} onChangeText={(v) => set({ protein_target_g: num(v) })} />
        </Row>
        <Row>
          <Field label="Carbs g" editable={!auto} keyboardType="number-pad" value={String(shown.carbs_target_g)} onChangeText={(v) => set({ carbs_target_g: num(v) })} />
          <Field label="Fat g" editable={!auto} keyboardType="number-pad" value={String(shown.fat_target_g)} onChangeText={(v) => set({ fat_target_g: num(v) })} />
        </Row>
      </Card>

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={styles.h2}>Staples</Text>
          <Switch value={draft.allow_staples ?? false} onValueChange={(v) => set({ allow_staples: v })} trackColor={{ true: colors.brand }} />
        </Row>
        <Text style={styles.muted}>
          Let recipes use salt, pepper, butter and oil even if they aren't in your pantry. Ripe won't track them or use them up.
        </Text>
      </Card>

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={styles.h2}>Apple Health</Text>
          <Switch value={draft.healthkit_enabled} onValueChange={toggleHealth} trackColor={{ true: colors.brand }} />
        </Row>
        <Text style={styles.muted}>
          {isHealthKitSupported()
            ? "Ripe reads what you've eaten and burned today, including anything MyFitnessPal logs, and saves the meals you cook back to Health. Only your remaining calories and macros leave your phone."
            : "Not available in this build. Ripe uses your manual targets."}
        </Text>
      </Card>

      <Card>
        <Row style={{ justifyContent: "space-between" }}>
          <Text style={styles.h2}>Expiry texts</Text>
          <Switch value={draft.nudges_enabled} onValueChange={(v) => set({ nudges_enabled: v })} trackColor={{ true: colors.brand }} />
        </Row>
        <Field label="Phone (E.164)" value={draft.phone ?? ""} onChangeText={(phone) => set({ phone })} keyboardType="phone-pad" placeholder="+15551234567" />
      </Card>

      <Button label="Save" onPress={onSave} loading={saving} />
      <Text style={{ height: 12 }} />
      <Button kind="secondary" label="Sign out" onPress={() => supabase.auth.signOut()} />
    </Screen>
  );
}
