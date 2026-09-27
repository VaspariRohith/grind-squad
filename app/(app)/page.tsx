"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Flame, Snowflake, Trophy, EyeOff, ShieldAlert } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import ActivityRow from "@/components/ActivityRow";
import { IconTile } from "@/components/Icon";
import ScoreRing from "@/components/ScoreRing";
import FreezeSheet from "@/components/FreezeSheet";
import { Avatar, Segmented, toast } from "@/components/ui";
import { addDays, greeting, niceDate } from "@/lib/dates";
import { activityPoints, dayScore, fmtPoints } from "@/lib/scoring";
import { errMsg, sb } from "@/lib/supabase";
import type { Adjustment, Freeze, Log } from "@/lib/types";

export default function TodayPage() {
  const { me, today, categories, activities } = useApp();
  const yesterday = addDays(today, -1);
  const [which, setWhich] = useState<"today" | "yesterday">("today");
  const day = which === "today" ? today : yesterday;

  const [logs, setLogs] = useState<Log[]>([]);
  const [freezes, setFreezes] = useState<Freeze[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [rank, setRank] = useState<{ rank: number; of: number } | null>(null);
  const [streak, setStreak] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [freezeOpen, setFreezeOpen] = useState(false);

  const load = useCallback(async () => {
    const s = sb();
    const [l, f, a, lb, st] = await Promise.all([
      s.from("logs").select("*").eq("user_id", me.id).gte("day", yesterday).lte("day", today),
      s.from("freezes").select("*").eq("user_id", me.id).gte("end_day", yesterday).order("start_day"),
      s.from("adjustments").select("*").eq("user_id", me.id).gte("day", yesterday).lte("day", today),
      s.rpc("leaderboard", { p_from: today, p_to: today }),
      s.rpc("streaks", { p_user: me.id }),
    ]);
    if (l.data) setLogs(l.data);
    if (f.data) setFreezes(f.data);
    if (a.data) setAdjustments(a.data);
    if (lb.data) {
      const mine = lb.data.find((r: { user_id: string }) => r.user_id === me.id);
      setRank(mine ? { rank: mine.rank, of: lb.data.length } : null);
    }
    if (st.data?.[0]) setStreak(st.data[0].current_streak);
    setLoaded(true);
  }, [me.id, today, yesterday]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const dayLogs = useMemo(() => logs.filter((l) => l.day === day), [logs, day]);
  const adj = adjustments.filter((a) => a.day === day).reduce((s, a) => s + a.points, 0);
  const score = dayScore(dayLogs, categories, adj);
  const frozen = freezes.find((f) => f.status === "approved" && day >= f.start_day && day <= f.end_day);
  const pending = freezes.filter((f) => f.status === "pending");

  const setValue = async (activityId: string, value: number) => {
    const a = activities.find((x) => x.id === activityId)!;
    const cat = categories.find((c) => c.id === a.category_id)!;
    const before = logs;
    const beforeCat = score.byCategory[cat.id]?.points ?? 0;
    const existing = logs.find((l) => l.day === day && l.activity_id === activityId);

    // Optimistic update so the UI feels instant
    let next: Log[];
    if (value <= 0) next = logs.filter((l) => l !== existing);
    else {
      const row: Log = {
        ...(existing ?? {
          id: `tmp-${activityId}`, user_id: me.id, day, activity_id: activityId, category_id: cat.id,
          is_negative: cat.is_negative, voided: false, created_at: new Date().toISOString(),
        }),
        value, points: activityPoints(a, value, cat.is_negative), updated_at: new Date().toISOString(),
      } as Log;
      next = existing ? logs.map((l) => (l === existing ? row : l)) : [...logs, row];
    }
    setLogs(next);

    const after = dayScore(next.filter((l) => l.day === day), categories).byCategory[cat.id]?.points ?? 0;
    if (!cat.is_negative && after >= cat.daily_cap && beforeCat < cat.daily_cap) celebrate(cat.color_from, cat.color_to);

    const { data, error } = await sb().rpc("set_log", { p_day: day, p_activity: activityId, p_value: value });
    if (error) {
      setLogs(before);
      toast.err(errMsg(error));
      return;
    }
    if (data?.id) setLogs((cur) => cur.map((l) => (l.day === day && l.activity_id === activityId ? data : l)));
  };

  const valueOf = (id: string) => dayLogs.find((l) => l.activity_id === id)?.value ?? 0;
  const isVoided = (id: string) => dayLogs.find((l) => l.activity_id === id)?.voided ?? false;
  // Study + sleep (anything logged in minutes) can't add up to more than 24 hours
  const minuteIds = new Set(activities.filter((x) => x.unit === "min").map((x) => x.id));
  const maxFor = (id: string) => {
    const act = activities.find((x) => x.id === id);
    if (!act || act.unit !== "min") return undefined;
    const others = dayLogs.filter((l) => minuteIds.has(l.activity_id) && l.activity_id !== id).reduce((t, l) => t + Number(l.value), 0);
    return Math.min(act.log_max ?? 1440, 1440 - others);
  };

  const positives = categories.filter((c) => !c.is_negative);
  const negatives = categories.filter((c) => c.is_negative);

  return (
    <div className="rise">
      <header className="pt-safe mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-mute">{niceDate(day)}</p>
          <h1 className="text-[1.7rem] leading-tight font-black tracking-tight">
            {greeting()}, <span className="gradient-text">{me.display_name.split(" ")[0]}</span>
          </h1>
        </div>
        <Link href="/profile"><Avatar name={me.display_name} url={me.avatar_url} size={46} ring="#ff4d8d" /></Link>
      </header>

      <Segmented value={which} onChange={setWhich}
        options={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }]} />

      {/* Score card */}
      <section className="card relative mt-4 overflow-hidden p-5">
        <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-pink-500/20 blur-3xl" />
        <div className="relative flex items-center gap-5">
          <ScoreRing value={frozen ? 0 : score.total} max={score.maxPositive} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <span className="chip" style={{ background: "rgba(251,146,60,.15)", color: "#fdba74" }}>
                <Flame className="h-3.5 w-3.5" /> {streak} day streak
              </span>
              {rank && which === "today" && (
                <Link href="/board" className="chip" style={{ background: "rgba(250,204,21,.13)", color: "#fde047" }}>
                  <Trophy className="h-3.5 w-3.5" /> #{rank.rank} of {rank.of}
                </Link>
              )}
            </div>
            {positives.map((c) => {
              const b = score.byCategory[c.id];
              const pct = Math.min(100, (Math.max(0, b?.points ?? 0) / c.daily_cap) * 100);
              return (
                <div key={c.id} className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${c.color_from}, ${c.color_to})` }} />
                  </div>
                  <span className="w-10 text-right text-[11px] font-bold text-mute tabular-nums">{b?.points ?? 0}/{c.daily_cap}</span>
                </div>
              );
            })}
          </div>
        </div>
        {adj !== 0 && (
          <p className="relative mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
            <ShieldAlert className="h-4 w-4" /> Admin adjustment {fmtPoints(adj)} on this day
          </p>
        )}
      </section>

      {frozen ? (
        <section className="card relative mt-4 overflow-hidden p-6 text-center"
          style={{ background: "linear-gradient(160deg, rgba(125,211,252,.18), rgba(99,102,241,.12))", borderColor: "rgba(125,211,252,.3)" }}>
          <Snowflake className="frost mx-auto h-14 w-14 text-sky-300" />
          <h2 className="mt-3 text-2xl font-black">Frozen day</h2>
          <p className="mt-1 text-sm text-soft">{frozen.reason || "Approved by the admin."} No points, no penalties, streak safe.</p>
        </section>
      ) : (
        <>
          {positives.map((c, i) => {
            const acts = activities.filter((a) => a.category_id === c.id && a.active);
            const b = score.byCategory[c.id];
            const maxed = (b?.points ?? 0) >= c.daily_cap;
            return (
              <section key={c.id} className="card rise mt-4 p-2" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="flex items-center gap-3 px-2 pt-2 pb-1">
                  <IconTile name={c.icon} from={c.color_from} to={c.color_to} />
                  <div className="flex-1">
                    <h2 className="text-lg font-extrabold">{c.name}</h2>
                    <p className="text-xs text-mute">Up to {c.daily_cap} pts a day</p>
                  </div>
                  <span className="chip text-sm" style={maxed ? { background: `linear-gradient(135deg, ${c.color_from}, ${c.color_to})`, color: "#fff" } : undefined}>
                    {maxed ? "MAXED" : `${b?.points ?? 0}/${c.daily_cap}`}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {acts.map((a) => (
                    <ActivityRow key={a.id} a={a} cat={c} value={valueOf(a.id)} voided={isVoided(a.id)}
                      disabled={!loaded} maxValue={maxFor(a.id)} onChange={(v) => setValue(a.id, v)} />
                  ))}
                </div>
              </section>
            );
          })}

          {negatives.map((c) => {
            const acts = activities.filter((a) => a.category_id === c.id && a.active);
            const b = score.byCategory[c.id];
            return (
              <section key={c.id} className="card mt-4 p-2" style={{ borderColor: "rgba(244,63,94,.25)", background: "linear-gradient(180deg, rgba(244,63,94,.08), rgba(244,63,94,.02)), var(--color-card)" }}>
                <div className="flex items-center gap-3 px-2 pt-2 pb-1">
                  <IconTile name={c.icon} from={c.color_from} to={c.color_to} />
                  <div className="flex-1">
                    <h2 className="text-lg font-extrabold">{c.name}</h2>
                    <p className="flex items-center gap-1 text-xs text-mute"><EyeOff className="h-3 w-3" /> Only you and the admin see these</p>
                  </div>
                  <span className="chip text-sm" style={{ color: (b?.points ?? 0) < 0 ? "#fb7185" : undefined }}>{b?.points ?? 0}</span>
                </div>
                {acts.map((a) => (
                  <ActivityRow key={a.id} a={a} cat={c} value={valueOf(a.id)} disabled={!loaded} onChange={(v) => setValue(a.id, v)} />
                ))}
                <p className="px-3 pt-1 pb-2 text-xs text-mute">Be honest. The squad runs on trust.</p>
              </section>
            );
          })}
        </>
      )}

      {/* Freeze */}
      <section className="mt-4 mb-2">
        <button onClick={() => setFreezeOpen(true)} className="card flex w-full items-center gap-3 p-4 text-left transition active:scale-[.99]">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-sky-400/15 text-sky-300"><Snowflake className="h-6 w-6" /></div>
          <div className="flex-1">
            <p className="font-bold">Cheat day or trip?</p>
            <p className="text-xs text-mute">Request a freeze. The admin approves it.</p>
          </div>
          {pending.length > 0 && <span className="chip" style={{ background: "rgba(125,211,252,.15)", color: "#7dd3fc" }}>{pending.length} pending</span>}
        </button>
      </section>

      <FreezeSheet open={freezeOpen} onClose={() => setFreezeOpen(false)} freezes={freezes} onChanged={load} />
    </div>
  );
}

async function celebrate(from: string, to: string) {
  const confetti = (await import("canvas-confetti")).default;
  confetti({ particleCount: 70, spread: 70, origin: { y: 0.7 }, colors: [from, to, "#ffffff"], disableForReducedMotion: true });
}
