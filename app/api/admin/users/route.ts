import { adminClient, json, requireAdmin } from "@/lib/server";

// Admin-only actions that need full Auth access:
//   { action: "reset_password", userId, password }
//   { action: "delete", userId }
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

  return json({ error: "Unknown action" }, 400);
}
