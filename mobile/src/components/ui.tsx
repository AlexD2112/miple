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
  bg: "#F2F2F7",
  card: "#FFFFFF",
  text: "#1C1C1E",
  muted: "#8E8E93",
  border: "#E5E5EA",
  brand: "#3F7D20",
  brandSoft: "#E7F3DC",
  warn: "#FF9500",
  warnSoft: "#FFF4E5",
  danger: "#FF3B30",
  dangerSoft: "#FFECEA",
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
    <View style={styles.titleBlock}>
      <Text style={styles.title}>{children}</Text>
      {sub ? <Text style={styles.subtitle}>{sub}</Text> : null}
    </View>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ?? null}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Stat({
  value,
  label,
  unit,
  color,
}: {
  value: string | number;
  label: string;
  unit?: string;
  color?: string;
}) {
  return (
    <View>
      <Text style={[styles.statValue, color ? { color } : null]}>
        {value}
        {unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export function ProgressBar({
  progress,
  color = colors.brand,
  trackColor = colors.border,
}: {
  progress: number;
  color?: string;
  trackColor?: string;
}) {
  const amount = Math.max(0, Math.min(1, progress));
  return (
    <View style={[styles.track, { backgroundColor: trackColor }]}>
      <View style={[styles.fill, { width: `${amount * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

export function ProgressRing({
  progress,
  size = 76,
  stroke = 8,
  color = colors.brand,
  trackColor = colors.border,
  innerColor = colors.card,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  innerColor?: string;
  children?: ReactNode;
}) {
  const pct = Math.max(0, Math.min(100, progress * 100));
  const radius = size / 2;
  const ring = Math.min(Math.max(stroke, 2), radius - 1);
  const right = pct >= 50 ? "180deg" : `${pct * 3.6}deg`;
  const left = pct >= 50 ? `${(pct - 50) * 3.6}deg` : "0deg";
  const inner = (radius - ring) * 2;

  return (
    <View style={[styles.ring, { width: size, height: size, borderRadius: radius, backgroundColor: trackColor }]}>
      <View style={[styles.ringClip, { width: radius, height: size, left: 0 }]}>
        <View
          style={{
            position: "absolute",
            left: radius,
            width: radius,
            height: size,
            backgroundColor: color,
            borderTopRightRadius: radius,
            borderBottomRightRadius: radius,
            transform: [{ translateX: -radius / 2 }, { rotate: left }, { translateX: radius / 2 }],
          }}
        />
      </View>
      <View style={[styles.ringClip, { left: radius, width: radius, height: size }]}>
        <View
          style={{
            position: "absolute",
            left: -radius,
            width: radius,
            height: size,
            backgroundColor: color,
            borderTopLeftRadius: radius,
            borderBottomLeftRadius: radius,
            transform: [{ translateX: radius / 2 }, { rotate: right }, { translateX: -radius / 2 }],
          }}
        />
      </View>
      <View
        style={{
          width: inner,
          height: inner,
          borderRadius: inner / 2,
          backgroundColor: innerColor,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {children}
      </View>
    </View>
  );
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
        { backgroundColor: bg, opacity: disabled ? 0.45 : pressed ? 0.82 : 1 },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }, small && styles.buttonTextSmall]}>{label}</Text>}
    </Pressable>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && { backgroundColor: colors.brand }]}>
      <Text style={[styles.chipText, selected && { color: "#fff" }]}>{label.replace(/_/g, " ")}</Text>
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
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function ExpiryBadge({ days, label }: { days: number; label?: string }) {
  const tone = days <= 1 ? "danger" : days <= 3 ? "warn" : "good";
  const text = label ?? (days < 0 ? "Expired" : days === 0 ? "Today" : days === 1 ? "1 day" : `${days} days`);
  return <Pill label={text} tone={tone} />;
}

export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
    </View>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={styles.input} {...props} />
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 56 },
  titleBlock: { marginBottom: 22 },
  title: { fontSize: 34, lineHeight: 41, fontWeight: "700", letterSpacing: 0.37, color: colors.text },
  subtitle: { fontSize: 17, lineHeight: 22, color: colors.muted, marginTop: 4 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    marginBottom: 10,
    gap: 12,
  },
  sectionTitle: { fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: -0.2, color: colors.text },
  h2: { fontSize: 20, lineHeight: 25, fontWeight: "700", letterSpacing: -0.2, color: colors.text, marginBottom: 8 },
  body: { fontSize: 17, lineHeight: 22, color: colors.text },
  muted: { fontSize: 15, lineHeight: 20, color: colors.muted },
  label: { fontSize: 13, lineHeight: 18, color: colors.muted, marginBottom: 6, fontWeight: "600" },
  card: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  statValue: { fontSize: 34, lineHeight: 38, fontWeight: "700", letterSpacing: -0.6, color: colors.text, fontVariant: ["tabular-nums"] },
  statUnit: { fontSize: 17, lineHeight: 22, fontWeight: "600", letterSpacing: 0, color: colors.muted },
  statLabel: { fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 2, fontWeight: "500" },
  track: { height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: colors.border },
  fill: { height: 8, borderRadius: 4 },
  ring: { overflow: "hidden", alignItems: "center", justifyContent: "center" },
  ringClip: { position: "absolute", top: 0, overflow: "hidden" },
  button: { borderRadius: 14, minHeight: 50, paddingVertical: 14, paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  buttonSmall: { minHeight: 34, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10 },
  buttonText: { fontSize: 17, fontWeight: "700" },
  buttonTextSmall: { fontSize: 13, fontWeight: "700" },
  chip: {
    backgroundColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  pillText: { fontSize: 12, fontWeight: "600" },
  empty: { alignItems: "center", paddingVertical: 36, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 20, lineHeight: 25, fontWeight: "700", color: colors.text, textAlign: "center" },
  emptyMessage: { fontSize: 15, lineHeight: 20, color: colors.muted, textAlign: "center", marginTop: 6 },
  field: { marginBottom: 14, flex: 1 },
  input: {
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    color: colors.text,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
});
