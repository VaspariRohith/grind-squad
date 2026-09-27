import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

let client: SupabaseClient | null = null;

/** Browser Supabase client. The session is stored on the device. */
export function sb(): SupabaseClient {
  if (!client) {
    if (!url || !key) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
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
