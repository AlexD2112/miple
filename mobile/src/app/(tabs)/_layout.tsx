import { Tabs } from "expo-router";
import { Text, type ColorValue } from "react-native";
import { colors } from "@/components/ui";

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ fontSize: 20, color }}>{glyph}</Text>;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarStyle: { backgroundColor: colors.card },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Pantry", tabBarIcon: icon("🥬") }} />
      <Tabs.Screen name="plan" options={{ title: "Plan", tabBarIcon: icon("📅") }} />
      <Tabs.Screen name="scan" options={{ title: "Scan", tabBarIcon: icon("🧾") }} />
      <Tabs.Screen name="budget" options={{ title: "Budget", tabBarIcon: icon("💸") }} />
      <Tabs.Screen name="profile" options={{ title: "Me", tabBarIcon: icon("🙂") }} />
    </Tabs>
  );
}
