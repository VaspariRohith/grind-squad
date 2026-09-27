"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { sb } from "@/lib/supabase";
import type { Activity, Category, Profile } from "@/lib/types";
import { Spinner } from "./ui";

type Ctx = {
  session: Session;
  me: Profile;
  today: string;
  categories: Category[];
  activities: Activity[];
  members: Profile[];
  reload: () => Promise<void>;
};

const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
};

export function AppProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [state, setState] = useState<Omit<Ctx, "reload"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (session: Session) => {
    const s = sb();
    const [me, today, cats, acts, members] = await Promise.all([
      s.from("profiles").select("*").eq("id", session.user.id).single(),
      s.rpc("app_today"),
      s.from("categories").select("*").order("sort"),
      s.from("activities").select("*").order("sort"),
      s.from("profiles").select("*").order("display_name"),
    ]);
    const err = me.error || today.error || cats.error || acts.error || members.error;
    if (err) throw err;
    setState({
      session, me: me.data, today: today.data as string,
      categories: cats.data, activities: acts.data, members: members.data,
    });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await sb().auth.getSession();
        if (!data.session) { router.replace("/login"); return; }
        if (alive) await load(data.session);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    const { data: sub } = sb().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/login");
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [load, router]);

  // Refresh "today" + profile when the app comes back to the foreground
  useEffect(() => {
    const onVis = async () => {
      if (document.visibilityState !== "visible" || !state) return;
      const { data } = await sb().auth.getSession();
      if (data.session) load(data.session).catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [state, load]);

  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center p-8 text-center">
        <div>
          <p className="text-lg font-bold">Couldn&apos;t load the app</p>
          <p className="mt-2 text-sm text-mute">{error}</p>
          <button className="btn btn-ghost mt-5" onClick={() => location.reload()}>Try again</button>
        </div>
      </div>
    );
  }
  if (!state) {
    return <div className="grid min-h-dvh place-items-center"><Spinner className="h-9 w-9" /></div>;
  }
  if (path.startsWith("/admin") && !state.me.is_admin) {
    router.replace("/");
    return null;
  }

  return (
    <AppCtx.Provider value={{ ...state, reload: () => load(state.session) }}>
      {children}
    </AppCtx.Provider>
  );
}
