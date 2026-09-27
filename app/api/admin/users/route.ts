import { adminClient, json, requireAdmin } from "@/lib/server";
import { usernameToEmail, USERNAME_RE } from "@/lib/supabase";

// Admin-only actions that need full Auth access:
//   { action: "reset_password", userId, password }
//   { action: "delete", userId }
//   { action: "rename", userId, username }
export async function POST(req: Request) {
  const me = await requireAdmin(req);
  if (!me) return json({ error: "Admins only" }, 403);

  const body = await req.json().catch(() => ({}));
  const userId = String(body.userId ?? "");
  if (!userId) return json({ error: "Missing user" }, 400);
  const admin = adminClient();

  if (body.action === "reset_password") {
    const password = String(body.password ?? "");
    if (password.length < 6) return json({ error: "Password needs at least 6 characters" }, 400);
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }

  if (body.action === "delete") {
    if (userId === me.id) return json({ error: "You can't delete yourself" }, 400);
    const { error } = await admin.auth.admin.deleteUser(userId);
    return error ? json({ error: error.message }, 400) : json({ ok: true });
  }

  if (body.action === "rename") {
    // The username is part of the login (it becomes the hidden email), so change both together
    const username = String(body.username ?? "").trim().toLowerCase();
    if (!USERNAME_RE.test(username)) return json({ error: "Username: 3–20 lowercase letters, numbers or _" }, 400);
    const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken && taken.id !== userId) return json({ error: "That username is taken" }, 409);
    const { data: before } = await admin.from("profiles").select("username").eq("id", userId).single();
    if (!before) return json({ error: "User not found" }, 404);

    const { error: authErr } = await admin.auth.admin.updateUserById(userId, { email: usernameToEmail(username), email_confirm: true });
    if (authErr) return json({ error: authErr.message }, 400);
    const { error: profErr } = await admin.from("profiles").update({ username }).eq("id", userId);
    if (profErr) {
      // put the login back so the account doesn't end up half-renamed
      await admin.auth.admin.updateUserById(userId, { email: usernameToEmail(before.username), email_confirm: true });
      return json({ error: profErr.message }, 400);
    }
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
}
