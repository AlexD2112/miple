import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import type { Profile } from "./types";

interface ProfileContext {
  profile: Profile | null;
  refresh: () => Promise<void>;
  save: (patch: Partial<Profile>) => Promise<void>;
}

const Ctx = createContext<ProfileContext>({ profile: null, refresh: async () => {}, save: async () => {} });

export function ProfileProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (error) console.warn("[profile]", error.message);
    else setProfile(data as Profile);
  }, [userId]);

  const save = useCallback(
    async (patch: Partial<Profile>) => {
      const { data, error } = await supabase.from("profiles").update(patch).eq("id", userId).select("*").single();
      if (error) throw error;
      setProfile(data as Profile);
    },
    [userId],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ profile, refresh, save }}>{children}</Ctx.Provider>;
}

export const useProfile = () => useContext(Ctx);
