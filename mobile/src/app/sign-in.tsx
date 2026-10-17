import { useState } from "react";
import { Alert, Text } from "react-native";
import { Button, Card, Field, Screen, Title, styles } from "@/components/ui";
import { supabase } from "@/lib/supabase";

/** Email one-time code: no passwords, no deep-link setup needed for the demo. */
export default function SignIn() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) return Alert.alert("Couldn't send code", error.message);
    setSent(true);
  }

  async function verify() {
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) Alert.alert("Wrong code", error.message);
  }

  return (
    <Screen>
      <Title sub="Scan groceries. Cook before it spoils.">Miple</Title>
      <Card>
        <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@school.edu" />
        {sent ? (
          <>
            <Field label="6-digit code" value={code} onChangeText={setCode} keyboardType="number-pad" />
            <Button label="Sign in" onPress={verify} loading={busy} />
            <Text style={[styles.muted, { marginTop: 8 }]}>Check your inbox for the code.</Text>
          </>
        ) : (
          <Button label="Send code" onPress={sendCode} loading={busy} disabled={!email.includes("@")} />
        )}
      </Card>
    </Screen>
  );
}
