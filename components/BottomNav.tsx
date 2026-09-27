"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ListChecks, Trophy, Newspaper, UserRound, ShieldCheck } from "lucide-react";
import { useApp } from "./AppProvider";

const TABS = [
  { href: "/", label: "Today", icon: ListChecks, color: "#ff4d8d" },
  { href: "/board", label: "Board", icon: Trophy, color: "#facc15" },
  { href: "/feed", label: "Feed", icon: Newspaper, color: "#22d3ee" },
  { href: "/profile", label: "Profile", icon: UserRound, color: "#a78bfa" },
];

export default function BottomNav() {
  const path = usePathname();
  const { me } = useApp();
  const tabs = me.is_admin ? [...TABS, { href: "/admin", label: "Admin", icon: ShieldCheck, color: "#34d399" }] : TABS;
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 flex justify-center px-3">
      <div className="mb-1 flex w-full max-w-md items-center justify-around rounded-[1.75rem] border border-white/10 bg-[#15151f]/85 px-2 py-2 shadow-2xl shadow-black/60 backdrop-blur-xl">
        {tabs.map((t) => {
          const active = t.href === "/" ? path === "/" : path.startsWith(t.href) || (t.href === "/profile" && path.startsWith("/u/"));
          const I = t.icon;
          return (
            <Link key={t.href} href={t.href}
              className="flex flex-1 flex-col items-center gap-0.5 rounded-2xl py-1.5 transition-all active:scale-95">
              <span className="grid h-9 w-12 place-items-center rounded-2xl transition-all"
                style={active ? { background: `${t.color}26`, color: t.color } : { color: "#6b6b85" }}>
                <I className="h-[22px] w-[22px]" strokeWidth={active ? 2.6 : 2.1} />
              </span>
              <span className="text-[10px] font-bold" style={{ color: active ? "#fff" : "#6b6b85" }}>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
