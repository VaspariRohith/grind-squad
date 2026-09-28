"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Flame, Snowflake } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import AwardCard from "@/components/AwardCard";
import StreakBadgeArt from "@/components/StreakBadgeArt";
import { Avatar, PageHeader, Segmented, Spinner } from "@/components/ui";
import { topBadge } from "@/lib/badges";
import { addDays, daysLeftInMonth, monthEnd, monthStart, weekStart, yearStart } from "@/lib/dates";
import { sb } from "@/lib/supabase";
import type { Award, BoardRow } from "@/lib/types";

type Period = "day" | "week" | "month" | "ytd" | "all";

const MEDALS = ["#FACC15", "#CBD5E1", "#F59E0B"];

export default function BoardPage() {
  const { today, members, me } = useApp();
  const [period, setPeriod] = useState<Period>("week");
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [awards, setAwards] = useState<Award[]>([]);

  const range = useMemo(() => {
    switch (period) {
      // Whole periods by date, so friends in a timezone ahead of yours
      // (already on "tomorrow") are still counted in the right week/month
      case "day": return [today, today];
      case "week": return [weekStart(today), addDays(weekStart(today), 6)];
      case "month": return [monthStart(today), monthEnd(today)];
      case "ytd": return [yearStart(today), today.slice(0, 5) + "12-31"];
      default: return ["2000-01-01", addDays(today, 1)];
    }
  }, [period, today]);

  useEffect(() => {
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRows(null);
    sb().rpc("leaderboard", { p_from: range[0], p_to: range[1] }).then(({ data }) => {
      if (alive) setRows((data as BoardRow[]) ?? []);
    });
    return () => { alive = false; };
  }, [range]);

  useEffect(() => {
    (async () => {
      await sb().rpc("finalize_awards"); // hands out awards for any month/year that just ended
      const { data } = await sb().from("awards").select("*").order("period", { ascending: false }).order("kind");
      setAwards(data ?? []);
    })();
  }, []);

  const nameOf = (id: string) => members.find((m) => m.id === id)?.display_name ?? "Someone";
  const top3 = rows?.slice(0, 3) ?? [];
  const periods = [...new Set(awards.map((a) => a.period))];

  return (
    <div className="rise">
      <PageHeader title="Leaderboard" sub={`${daysLeftInMonth(today)} days left in the monthly race`} />
      <Segmented size="sm" value={period} onChange={setPeriod} options={[
        { value: "day", label: "Today" }, { value: "week", label: "Week" }, { value: "month", label: "Month" },
        { value: "ytd", label: "YTD" }, { value: "all", label: "All" },
      ]} />

      {!rows ? (
        <div className="grid h-72 place-items-center"><Spinner /></div>
      ) : (
        <>
          {/* Podium */}
          <section className="mt-6 grid grid-cols-3 items-end gap-2">
            {[1, 0, 2].map((i) => {
              const r = top3[i];
              if (!r) return <div key={i} />;
              const h = i === 0 ? 118 : i === 1 ? 88 : 70;
              return (
                <Link key={r.user_id} href={`/u/${r.username}`} className="flex flex-col items-center">
                  {i === 0 && <span className="mb-1 text-2xl">👑</span>}
                  <Avatar name={r.display_name} url={r.avatar_url} size={i === 0 ? 70 : 56} ring={MEDALS[i]} />
                  <p className="mt-2 max-w-full truncate text-sm font-bold">{r.display_name}</p>
                  <p className="text-xs font-extrabold tabular-nums" style={{ color: MEDALS[i] }}>{r.points} pts</p>
                  <div className="mt-2 grid w-full place-items-start justify-center rounded-t-2xl pt-2 text-2xl font-black"
                    style={{ height: h, background: `linear-gradient(180deg, ${MEDALS[i]}55, ${MEDALS[i]}08)`, color: MEDALS[i] }}>
                    {r.rank}
                  </div>
                </Link>
              );
            })}
          </section>

          {/* Full list */}
          <section className="card -mt-1 divide-y divide-white/[0.06] overflow-hidden">
            {rows.map((r) => {
              const badge = topBadge(r.best_streak);
              const isMe = r.user_id === me.id;
              return (
                <Link key={r.user_id} href={`/u/${r.username}`}
                  className="flex items-center gap-3 px-4 py-3 transition active:bg-white/5"
                  style={isMe ? { background: "rgba(255,77,141,.08)" } : undefined}>
                  <span className="w-6 text-center text-lg font-black tabular-nums"
                    style={{ color: r.rank <= 3 ? MEDALS[r.rank - 1] : "#6b6b85" }}>{r.rank}</span>
                  <Avatar name={r.display_name} url={r.avatar_url} size={42} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{r.display_name}{isMe && <span className="ml-1.5 text-xs text-brand">you</span>}</p>
                    <div className="flex items-center gap-2 text-xs text-mute">
                      <span className="flex items-center gap-0.5" style={{ color: r.current_streak ? "#fdba74" : undefined }}>
                        <Flame className="h-3.5 w-3.5" />{r.current_streak}
                      </span>
                      <span>{r.days_logged}d logged</span>
                      {r.frozen_days > 0 && <span className="flex items-center gap-0.5 text-sky-300"><Snowflake className="h-3 w-3" />{r.frozen_days}</span>}
                    </div>
                  </div>
                  {badge && <StreakBadgeArt badge={badge} size={34} />}
                  <span className="min-w-[3.5rem] text-right text-lg font-black tabular-nums">{r.points}</span>
                </Link>
              );
            })}
          </section>
          <p className="mt-2 px-2 text-xs text-mute">Net points: good habits minus slip-ups, plus any admin adjustments.</p>
        </>
      )}

      {/* Hall of fame */}
      <section className="mt-8">
        <h2 className="mb-1 text-2xl font-black">Hall of Fame</h2>
        <p className="mb-3 text-sm text-mute">Every month: a champion, and a not-so-proud last place. Yearly titles on Jan 1.</p>
        {periods.length === 0 ? (
          <div className="card p-5 text-center text-sm text-soft">
            🏆 The first awards drop when this month ends. Don&apos;t be last.
          </div>
        ) : (
          <div className="space-y-4">
            {periods.map((p) => (
              <div key={p} className="space-y-2">
                {awards.filter((a) => a.period === p).map((a) => <AwardCard key={a.id} award={a} who={nameOf(a.user_id)} />)}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
