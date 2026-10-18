import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

/** Loads data whenever the screen gains focus; returns [data, reload, loading]. */
export function useFocusData<T>(load: () => Promise<T>, deps: unknown[] = []): [T | null, () => Promise<void>, boolean] {
  const [data, setData] = useState<T | null>(null);
  // Starts true: the first load begins as soon as the screen is focused.
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await load());
    } catch (err) {
      console.warn(err);
    } finally {
      setLoading(false);
    }
  }, deps);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  return [data, reload, loading];
}
