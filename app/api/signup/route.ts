import { adminClient, json } from "@/lib/server";
import { usernameToEmail, USERNAME_RE } from "@/lib/supabase";

// Creates an account only with a valid, unused invite code.
// The database trigger double-checks and claims the code in the same
// transaction, so even a direct call to Supabase can't skip it.
export async function POST(req: Request) {
  let body: { inviteCode?: string; username?: string; displayName?: string; password?: string };
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  const code = String(body.inviteCode ?? "").trim().toUpperCase();
  const username = String(body.username ?? "").trim().toLowerCase();
  const displayName = String(body.displayName ?? "").trim().slice(0, 30) || username;
  const password = String(body.password ?? "");

  if (!code) return json({ error: "Enter your invite code" }, 400);
  if (!USERNAME_RE.test(username)) return json({ error: "Username: 3–20 lowercase letters, numbers or _" }, 400);
  if (password.length < 6) return json({ error: "Password needs at least 6 characters" }, 400);

  const admin = adminClient();

  const { data: invite } = await admin.from("invite_codes").select("code, used_by, revoked").eq("code", code).maybeSingle();
  if (!invite || invite.revoked) return json({ error: "That invite code doesn't exist" }, 400);
  if (invite.used_by) return json({ error: "That invite code was already used" }, 400);

  const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (taken) return json({ error: "That username is taken" }, 409);

  const { error } = await admin.auth.admin.createUser({
    email: usernameToEmail(username),
    password,
    email_confirm: true,
    user_metadata: { username, display_name: displayName, invite_code: code },
  });
  if (error) {
    const msg = /already|registered|exists/i.test(error.message) ? "That username is taken"
      : /database error/i.test(error.message) ? "That invite code can't be used" : error.message;
    return json({ error: msg }, 400);
  }
  return json({ ok: true });
}
