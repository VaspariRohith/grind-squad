"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, Flame, Lock, Star, Trophy, Zap } from "lucide-react";
import AwardCard from "./AwardCard";
import StreakBadgeArt from "./StreakBadgeArt";
import { Avatar, PhotoViewer, Sheet } from "./ui";
import { nextBadge, STREAK_BADGES, type StreakBadge } from "@/lib/badges";
import { sb } from "@/lib/supabase";
import type { Award, Profile } from "@/lib/types";

type Stats = { total_points: number; month_points: number; year_points: number; days_logged: number; current_streak: number; best_streak: number };

export default function ProfileView({ profile, actions }: { profile: Profile; actions?: ReactNode }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [awards, setAwards] = useState<Award[]>([]);
  const [openBadge, setOpenBadge] = useState<StreakBadge | null>(null);
  const [viewPhoto, setViewPhoto] = useState(false);

  useEffect(() => {
    sb().rpc("profile_stats", { p_user: profile.id }).then(({ data }) => setStats(data?.[0] ?? null));
    sb().from("awards").select("*").eq("user_id", profile.id).order("period", { ascending: false })
      .then(({ data }) => setAwards(data ?? []));
  }, [profile.id]);

  const best = stats?.best_streak ?? 0;
  const cur = stats?.current_streak ?? 0;
  const next = nextBadge(cur);
  const earnedCount = STREAK_BADGES.filter((b) => best >= b.days).length;

  const tiles = [
    { label: "Streak", value: cur, icon: Flame, color: "#fb923c" },
    { label: "Best streak", value: best, icon: Zap, color: "#facc15" },
    { label: "This month", value: stats?.month_points ?? 0, icon: CalendarDays, color: "#22d3ee" },
    { label: "All-time pts", value: stats?.total_points ?? 0, icon: Star, color: "#f472b6" },
  ];

  return (
    <div className="rise">
      {/* Header */}
      <section className="card relative mt-2 overflow-hidden px-5 pb-5 text-center">
        <div className="absolute inset-x-0 top-0 h-28" style={{ background: "linear-gradient(135deg,#ff4d8d55,#8b5cf655,#22d3ee44)" }} />
        <div className="relative mt-10 flex justify-center">
          {profile.avatar_url ? (
            <button onClick={() => setViewPhoto(true)} aria-label="View photo" className="rounded-full transition active:scale-95">
              <Avatar name={profile.display_name} url={profile.avatar_url} size={104} ring="#ff4d8d" />
            </button>
          ) : (
            <Avatar name={profile.display_name} url={profile.avatar_url} size={104} ring="#ff4d8d" />
          )}
        </div>
        <h1 className="relative mt-3 text-2xl font-black">{profile.display_name}</h1>
        <p className="relative text-sm font-semibold text-mute">@{profile.username}{profile.is_admin && " · admin"}</p>
        {profile.bio && <p className="relative mx-auto mt-2 max-w-xs text-sm text-soft">{profile.bio}</p>}
        {actions && <div className="relative mt-4">{actions}</div>}
      </section>

      {/* Stats */}
      <section className="mt-4 grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <t.icon className="h-5 w-5" style={{ color: t.color }} />
            <p className="mt-2 text-3xl font-black tabular-nums">{stats ? t.value : "–"}</p>
            <p className="text-xs font-bold text-mute">{t.label}</p>
          </div>
        ))}
      </section>

      {/* Next badge */}
      {next && (
        <section className="card mt-4 flex items-center gap-4 p-4">
          <StreakBadgeArt badge={next} size={60} locked />
          <div className="flex-1">
            <p className="text-xs font-bold text-mute">NEXT BADGE</p>
            <p className="font-extrabold">{next.name}</p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.08]">
              <div className="h-full rounded-full bg-gradient-to-r from-pink-500 to-amber-400 transition-all"
                style={{ width: `${Math.min(100, (cur / next.days) * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-mute">{next.days - cur} more day{next.days - cur === 1 ? "" : "s"} in a row</p>
          </div>
        </section>
      )}

      {/* Badges */}
      <section className="mt-6">
        <div className="mb-3 flex items-end justify-between px-1">
          <h2 className="text-xl font-black">Streak badges</h2>
          <span className="text-sm font-bold text-mute">{earnedCount}/{STREAK_BADGES.length}</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {STREAK_BADGES.map((b) => {
            const got = best >= b.days;
            return (
              <button key={b.days} onClick={() => setOpenBadge(b)} className="flex flex-col items-center rounded-2xl p-1.5 transition active:scale-95">
                <div className="relative">
                  <StreakBadgeArt badge={b} size={70} locked={!got} />
                  {!got && <Lock className="absolute right-1 bottom-1 h-4 w-4 text-mute" />}
                </div>
                <p className={`mt-0.5 line-clamp-2 text-center text-[10px] leading-tight font-bold ${got ? "text-white" : "text-mute"}`}>{b.name}</p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Trophies */}
      <section className="mt-6">
        <h2 className="mb-3 flex items-center gap-2 px-1 text-xl font-black"><Trophy className="h-5 w-5 text-amber-300" /> Trophy case</h2>
        {awards.length === 0 ? (
          <div className="card p-5 text-center text-sm text-mute">No trophies yet. Win a month to get one.</div>
        ) : (
          <div className="space-y-2">{awards.map((a) => <AwardCard key={a.id} award={a} />)}</div>
        )}
      </section>

      {viewPhoto && profile.avatar_url && <PhotoViewer url={profile.avatar_url} name={profile.display_name} onClose={() => setViewPhoto(false)} />}

      <Sheet open={!!openBadge} onClose={() => setOpenBadge(null)} title={openBadge?.name}>
        {openBadge && (
          <div className="flex flex-col items-center pb-2 text-center">
            <StreakBadgeArt badge={openBadge} size={170} locked={best < openBadge.days} />
            <p className="mt-3 text-lg font-bold">{openBadge.line}</p>
            <p className="mt-1 text-sm text-mute">
              {best >= openBadge.days ? "Unlocked" : `Unlocks at a ${openBadge.days}-day streak`}
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
