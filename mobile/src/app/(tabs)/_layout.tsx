import { router, Tabs } from "expo-router";
import { Pressable, Text, View, type ColorValue } from "react-native";
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
      <Tabs.Screen
        name="add"
        options={{
          title: "",
          tabBarAccessibilityLabel: "Quick add",
          tabBarButton: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quick add"
              onPress={() => router.push("/quick-add")}
              style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
            >
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  marginTop: -18,
                  backgroundColor: colors.brand,
                  alignItems: "center",
                  justifyContent: "center",
                  shadowColor: "#000",
                  shadowOpacity: 0.18,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 4 },
                }}
              >
                <Text style={{ color: "#fff", fontSize: 30, lineHeight: 32, fontWeight: "500" }}>+</Text>
              </View>
            </Pressable>
          ),
        }}
      />
      <Tabs.Screen name="scan" options={{ title: "Scan", tabBarButton: () => null, tabBarItemStyle: { display: "none" } }} />
      <Tabs.Screen name="budget" options={{ title: "Groceries", tabBarIcon: icon("🛒") }} />
      <Tabs.Screen name="profile" options={{ title: "Me", tabBarIcon: icon("🙂") }} />
    </Tabs>
  );
}
