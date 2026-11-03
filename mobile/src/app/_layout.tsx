import "@/lib/webShims";
import type { Session } from "@supabase/supabase-js";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@/components/ui";
import { syncCookedMealsToHealth } from "@/lib/health";
import { ProfileProvider, useProfile } from "@/lib/profile";
import { supabase } from "@/lib/supabase";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  const signedIn = !!session;

  const stack = (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={signedIn} redirectTo="/sign-in">
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="chef" />
        <Stack.Screen name="cook" />
        <Stack.Screen name="quick-add" options={{ presentation: "modal" }} />
        <Stack.Screen name="log-food" options={{ presentation: "modal" }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn} redirectTo="/">
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <View style={frame.page}>
        <View style={frame.column}>
          {session ? (
            <ProfileProvider userId={session.user.id}>
              <HealthSync />
              {stack}
            </ProfileProvider>
          ) : (
            stack
          )}
        </View>
      </View>
    </SafeAreaProvider>
  );
}

// The screens are laid out for a phone, so a desktop browser shows them in a phone-width column.
const frame = StyleSheet.create({
  page: { flex: 1, backgroundColor: Platform.OS === "web" ? "#E4E6DF" : colors.bg },
  column: Platform.OS === "web" ? { flex: 1, width: "100%", maxWidth: 520, alignSelf: "center", overflow: "hidden" } : { flex: 1 },
});

/** Meals cooked by SMS reply get written to Apple Health next time the app is opened. */
function HealthSync() {
  const { profile } = useProfile();
  useEffect(() => {
    if (!profile) return;
    syncCookedMealsToHealth(profile);
    const sub = AppState.addEventListener("change", (s) => s === "active" && syncCookedMealsToHealth(profile));
    return () => sub.remove();
  }, [profile]);
  return null;
}