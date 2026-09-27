"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Eye, EyeOff, ArrowRight } from "lucide-react";
import AuthLayout from "@/components/AuthLayout";
import { errMsg, sb, usernameToEmail } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    sb().auth.getSession().then(({ data }) => { if (data.session) router.replace("/"); });
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    const { error } = await sb().auth.signInWithPassword({ email: usernameToEmail(username), password });
    setBusy(false);
    if (error) return setError(errMsg(error));
    router.replace("/");
  };

  return (
    <AuthLayout title="Welcome back" sub="Show up. Log it. Beat your friends.">
      <form onSubmit={submit} className="space-y-3">
        <input className="field" placeholder="Username" autoCapitalize="none" autoCorrect="off" autoComplete="username"
          value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ""))} required />
        <div className="relative">
          <input className="field pr-12" placeholder="Password" type={show ? "text" : "password"} autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required />
          <button type="button" onClick={() => setShow(!show)} className="absolute top-1/2 right-3 -translate-y-1/2 p-1 text-mute" aria-label="Show password">
            {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
          </button>
        </div>
        {error && <p className="rise text-sm font-semibold text-rose-400">{error}</p>}
        <button className="btn btn-primary w-full py-4 text-lg" disabled={busy}>
          {busy ? "Signing in…" : <>Let&apos;s go <ArrowRight className="h-5 w-5" /></>}
        </button>
      </form>
      <p className="mt-8 text-center text-sm text-mute">
        Got an invite code?{" "}
        <Link href="/signup" className="font-bold text-white underline decoration-brand decoration-2 underline-offset-4">Join the squad</Link>
      </p>
      <p className="mt-3 text-center text-xs text-mute/70">Forgot your password? Ask the admin to reset it.</p>
    </AuthLayout>
  );
}
