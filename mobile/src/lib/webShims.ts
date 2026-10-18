import { Alert, Platform, Share } from "react-native";

/**
 * react-native-web leaves Alert.alert as a no-op and Share.share fails in browsers without the
 * Web Share API. These fill both in so the screens can keep calling them the same way on every platform.
 */
if (Platform.OS === "web") {
  Alert.alert = (title, message, buttons) => {
    const text = [title, message].filter(Boolean).join("\n\n");
    const cancel = buttons?.find((b) => b.style === "cancel");
    const action = buttons?.find((b) => b.style !== "cancel");
    if (cancel && action) {
      (window.confirm(text) ? action : cancel).onPress?.();
      return;
    }
    window.alert(text);
    buttons?.[0]?.onPress?.();
  };

  const nativeShare = Share.share;
  Share.share = async (content, options) => {
    if (typeof navigator.share === "function") return nativeShare(content, options);
    const text = "message" in content && content.message ? content.message : (content.url ?? "");
    await navigator.clipboard.writeText(text);
    window.alert("Copied to your clipboard.");
    return { action: Share.sharedAction, activityType: undefined };
  };
}
