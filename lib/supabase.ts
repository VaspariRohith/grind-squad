import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let client: SupabaseClient | null = null;

/* ---- "Keep me logged in" ----
 * On (default): the login is saved on the device (localStorage) and renewed
 * automatically, so you stay logged in until you tap Sign out.
 * Off: the login is kept only until the browser/app is closed (sessionStorage). */
const REMEMBER_KEY = "gs-remember";
const LAST_USER_KEY = "gs-last-user";
const safe = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export const getRemember = () => safe(() => localStorage.getItem(REMEMBER_KEY) !== "0", true);
export const setRemember = (on: boolean) => safe(() => localStorage.setItem(REMEMBER_KEY, on ? "1" : "0"), undefined);
export const getLastUsername = () => safe(() => localStorage.getItem(LAST_USER_KEY) ?? "", "");
export const setLastUsername = (u: string) => safe(() => localStorage.setItem(LAST_USER_KEY, u), undefined);

const sessionStore = {
  getItem: (k: string) => safe(() => localStorage.getItem(k) ?? sessionStorage.getItem(k), null),
  setItem: (k: string, v: string) => safe(() => {
    if (getRemember()) { localStorage.setItem(k, v); sessionStorage.removeItem(k); }
    else { sessionStorage.setItem(k, v); localStorage.removeItem(k); }
  }, undefined),
  removeItem: (k: string) => safe(() => { localStorage.removeItem(k); sessionStorage.removeItem(k); }, undefined),
};

/** Browser Supabase client. The session is stored on the device and refreshed automatically. */
export function sb(): SupabaseClient {
  if (!client) {
    if (!url || !key) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    client = createClient(url, key, {
      auth: {
        storage: typeof window === "undefined" ? undefined : sessionStore,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/** Usernames are turned into a hidden email because Supabase Auth needs one.
 *  Friends never see it. Never change this after people have signed up. */
export const EMAIL_DOMAIN = process.env.NEXT_PUBLIC_AUTH_EMAIL_DOMAIN || "users.grindsquad.app";
export const usernameToEmail = (u: string) => `${u.trim().toLowerCase()}@${EMAIL_DOMAIN}`;

export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;

/** Turns Postgres/Supabase errors into short human messages. */
export function errMsg(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e);
  if (m.includes("Invalid login credentials")) return "Wrong username or password";
  return m.replace(/^.*?ERROR:\s*/, "");
}
