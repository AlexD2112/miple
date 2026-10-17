import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export const colors = {
  bg: "#F6F8F3",
  card: "#FFFFFF",
  text: "#18210F",
  muted: "#66705C",
  border: "#E2E7DA",
  brand: "#3F7D20",
  brandSoft: "#E3F0D8",
  warn: "#C77700",
  warnSoft: "#FFF1D6",
  danger: "#B3261E",
  dangerSoft: "#FBE1DE",
};

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      {scroll ? <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView> : children}
    </SafeAreaView>
  );
}

export function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={styles.title}>{children}</Text>
      {sub ? <Text style={styles.muted}>{sub}</Text> : null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({
  label,
  onPress,
  kind = "primary",
  loading,
  disabled,
  small,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
}) {
  const bg = kind === "primary" ? colors.brand : kind === "danger" ? colors.dangerSoft : colors.brandSoft;
  const fg = kind === "primary" ? "#fff" : kind === "danger" ? colors.danger : colors.brand;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        small && styles.buttonSmall,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }, small && { fontSize: 13 }]}>{label}</Text>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && { backgroundColor: colors.brand, borderColor: colors.brand }]}>
      <Text style={{ color: selected ? "#fff" : colors.text, fontSize: 13 }}>{label.replace(/_/g, " ")}</Text>
    </Pressable>
  );
}

export function Pill({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "warn" | "danger" | "good" }) {
  const map = {
    neutral: [colors.border, colors.muted],
    warn: [colors.warnSoft, colors.warn],
    danger: [colors.dangerSoft, colors.danger],
    good: [colors.brandSoft, colors.brand],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: 10, flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={styles.input} {...props} />
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap: 8 }, style]}>{children}</View>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 28, fontWeight: "800", color: colors.text },
  h2: { fontSize: 17, fontWeight: "700", color: colors.text, marginBottom: 6 },
  body: { fontSize: 15, color: colors.text },
  muted: { fontSize: 13, color: colors.muted },
  label: { fontSize: 12, color: colors.muted, marginBottom: 4, fontWeight: "600" },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  button: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16, alignItems: "center" },
  buttonSmall: { paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9 },
  buttonText: { fontSize: 15, fontWeight: "700" },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  pill: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
});
