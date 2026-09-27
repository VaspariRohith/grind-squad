import { Flame } from "lucide-react";
import type { ReactNode } from "react";

export function Logo({ size = 64 }: { size?: number }) {
  return (
    <div className="relative grid place-items-center rounded-[28%] text-white"
      style={{ width: size, height: size, background: "linear-gradient(135deg,#ff4d8d,#ff9a3d)", boxShadow: "0 16px 40px -12px #ff4d8d" }}>
      <Flame style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={2.4} fill="rgba(255,255,255,0.25)" />
    </div>
  );
}

export default function AuthLayout({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <main className="pt-safe pb-safe relative mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center overflow-hidden px-6">
      <div className="pointer-events-none absolute -top-24 -right-24 h-72 w-72 rounded-full bg-pink-500/30 blur-3xl" />
      <div className="pointer-events-none absolute top-1/3 -left-28 h-72 w-72 rounded-full bg-indigo-500/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-20 right-0 h-64 w-64 rounded-full bg-amber-400/20 blur-3xl" />
      <div className="rise relative">
        <Logo />
        <h1 className="mt-6 text-4xl font-black tracking-tight">{title}</h1>
        <p className="mt-2 text-soft">{sub}</p>
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}
