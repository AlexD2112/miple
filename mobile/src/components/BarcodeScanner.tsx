import { useRef, useState } from "react";
import { Platform, Text, View } from "react-native";
import { Button, Field, colors, styles } from "./ui";

type ExpoCamera = typeof import("expo-camera");

// Loaded lazily: an iOS build made before expo-camera was added has no native module,
// and requiring it there throws. Typing the number in still works then.
let cameraModule: ExpoCamera | null | undefined;
function camera(): ExpoCamera | null {
  if (cameraModule !== undefined) return cameraModule;
  try {
    cameraModule = require("expo-camera") as ExpoCamera;
  } catch {
    cameraModule = null;
  }
  return cameraModule;
}

/** Scans a UPC/EAN with the camera, with a field to type the number as a fallback. */
export function BarcodeScanner({ onCode, busy }: { onCode: (code: string) => void; busy?: boolean }) {
  const mod = camera();
  const [typed, setTyped] = useState("");
  return (
    <View>
      {mod ? <Viewfinder mod={mod} onCode={onCode} paused={!!busy} /> : null}
      <Field
        label={mod ? "Or type the number under the barcode" : "Number under the barcode"}
        keyboardType="number-pad"
        value={typed}
        onChangeText={(t) => setTyped(t.replace(/\D/g, ""))}
        placeholder="e.g. 049000050103"
        onSubmitEditing={() => typed.length >= 8 && onCode(typed)}
      />
      <Button label="Look up" onPress={() => onCode(typed)} loading={busy} disabled={typed.length < 8} />
    </View>
  );
}

function Viewfinder({ mod, onCode, paused }: { mod: ExpoCamera; onCode: (code: string) => void; paused: boolean }) {
  const [permission, request] = mod.useCameraPermissions();
  const last = useRef<{ code: string; at: number } | null>(null);
  const { CameraView } = mod;

  if (!permission) return null;
  if (!permission.granted) {
    return (
      <View style={{ marginBottom: 12 }}>
        <Text style={[styles.muted, { marginBottom: 8 }]}>Ripe needs the camera to scan barcodes.</Text>
        <Button kind="secondary" label="Allow camera" onPress={request} />
      </View>
    );
  }

  return (
    <View style={{ height: 260, borderRadius: 16, overflow: "hidden", marginBottom: 12, backgroundColor: "#000" }}>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e"] }}
        onBarcodeScanned={
          paused
            ? undefined
            : ({ data }) => {
                // The scanner fires many times a second; act on each code once.
                const now = Date.now();
                if (last.current && last.current.code === data && now - last.current.at < 4000) return;
                last.current = { code: data, at: now };
                onCode(data);
              }
        }
      />
      <View
        pointerEvents="none"
        style={{ position: "absolute", left: "12%", right: "12%", top: "38%", height: 70, borderWidth: 2, borderColor: colors.brandSoft, borderRadius: 10 }}
      />
      {Platform.OS === "web" ? (
        <Text style={{ position: "absolute", bottom: 8, left: 0, right: 0, textAlign: "center", color: "#fff", fontSize: 12 }}>
          If nothing happens, type the number below.
        </Text>
      ) : null}
    </View>
  );
}
