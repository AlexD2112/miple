import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Alert, Text } from "react-native";
import { Button, Card, Screen, Title, styles } from "@/components/ui";
import { supabase } from "@/lib/supabase";

/** Must match a redirect URL allowed in the Supabase Auth settings. */
const redirectTo = "miple://auth";

WebBrowser.maybeCompleteAuthSession();

export default function SignIn() {
  const [busy, setBusy] = useState(false);

  async function signInWithGoogle() {
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      if (!data.url) throw new Error("Google sign-in did not return a URL");

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== "success") return;

      const params = paramsFromUrl(result.url);
      if (params.error) throw new Error(params.error_description || params.error);
      if (!params.code) throw new Error("Google sign-in did not return a code");

      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(params.code);
      if (exchangeError) throw exchangeError;
    } catch (err) {
      Alert.alert("Couldn't sign in", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Title sub="Scan groceries. Cook before it spoils.">Ripe</Title>
      <Card>
        <Button label="Continue with Google" onPress={signInWithGoogle} loading={busy} />
        <Text style={[styles.muted, { marginTop: 8 }]}>Signs in with your Google account.</Text>
      </Card>
    </Screen>
  );
}

function paramsFromUrl(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parsed = new URL(url);
  parsed.searchParams.forEach((value, key) => {
    out[key] = value;
  });
  const hash = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash;
  new URLSearchParams(hash).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}
