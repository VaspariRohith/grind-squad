"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, EyeOff, Ticket, ArrowRight } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { errMsg, sb, usernameToEmail, USERNAME_RE } from "@/lib/supabase";

export default function SignupPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Invite links look like /signup?code=GRIND-XXXX-XXXX
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (c) setCode(c.toUpperCase());
  }, []);

  const usernameOk = USERNAME_RE.test(username);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!usernameOk) return setError("Username: 3–20 characters, lowercase letters, numbers or _");
    if (password.length < 6) return setError("Password needs at least 6 characters");
    setBusy(true);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: code, username, displayName, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Sign up failed");
      const { error } = await sb().auth.signInWithPassword({ email: usernameToEmail(username), password });
      if (error) throw error;
      router.replace("/");
    } catch (e) {
      setError(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Join the squad" sub="Invite only. Your friend gave you a code.">
      <form onSubmit={submit} className="space-y-3">
        <div className="relative">
          <Ticket className="absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2 text-brand" />
          <input className="field pl-12 font-mono tracking-wider uppercase" placeholder="GRIND-XXXX-XXXX" autoCapitalize="characters"
            autoCorrect="off" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().trim())} required />
        </div>
        <div>
          <input className="field" placeholder="Username" autoCapitalize="none" autoCorrect="off" autoComplete="username"
            value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} maxLength={20} required />
          <p className={`mt-1.5 px-1 text-xs ${username && !usernameOk ? "text-amber-400" : "text-mute"}`}>
            You log in with this. Lowercase letters, numbers, _ (3–20).
          </p>
        </div>
        <input className="field" placeholder="Display name (what friends see)" maxLength={30}
          value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <div className="relative">
          <input className="field pr-12" placeholder="Password (6+ characters)" type={show ? "text" : "password"} autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="button" onClick={() => setShow(!show)} className="absolute top-1/2 right-3 -translate-y-1/2 p-1 text-mute" aria-label="Show password">
            {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        {error && <p className="rise text-sm font-semibold text-rose-400">{error}</p>}
        <button className="btn btn-primary w-full py-4 text-lg" disabled={busy}>
          {busy ? "Creating account…" : <>Create account <ArrowRight className="h-5 w-5" /></>}
        </button>
      </form>
      <p className="mt-8 text-center text-sm text-mute">
        Already in?{" "}
        <Link href="/login" className="font-bold text-white underline decoration-brand decoration-2 underline-offset-4">Log in</Link>
      </p>
    </AuthLayout>
  );
}
