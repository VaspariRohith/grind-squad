"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Flag, Gavel, RefreshCw, ShieldAlert, Snowflake, ThumbsDown, ThumbsUp } from "lucide-react";
import { useApp } from "@/components/AppProvider";
import Icon from "@/components/Icon";
import { rangeLabel } from "@/components/FreezeSheet";
import { Avatar, Empty, PageHeader, Sheet, Spinner, toast } from "@/components/ui";
import { addDays, dayLabel, timeAgo, timeLeft } from "@/lib/dates";
import { fmtCount, fmtPoints } from "@/lib/scoring";
import { errMsg, sb } from "@/lib/supabase";
import type { Activity, Adjustment, Freeze, Log, Report } from "@/lib/types";

type ReportWithLog = Report & { logs: Pick<Log, "activity_id" | "day" | "value" | "user_id" | "points"> | null };

export default function FeedPage() {
  const { today, members, me, activities, categories } = useApp();
  const from = addDays(today, -2);
  const [logs, setLogs] = useState<Log[] | null>(null);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [freezes, setFreezes] = useState<Freeze[]>([]);
  const [reports, setReports] = useState<ReportWithLog[]>([]);
  const [myVotes, setMyVotes] = useState<Record<string, string>>({});
  const [left, setLeft] = useState(3);
  const [picked, setPicked] = useState<Log | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const s = sb();
    await s.rpc("resolve_due_reports");
    const since = new Date(Date.now() - 3 * 86400e3).toISOString();
    const [l, a, f, r, v, n] = await Promise.all([
      s.from("logs").select("*").eq("is_negative", false).gte("day", from).order("created_at", { ascending: false }),
      s.from("adjustments").select("*").gte("day", from).order("created_at", { ascending: false }),
      s.from("freezes").select("*").eq("status", "approved").gte("end_day", from).lte("start_day", today),
      s.from("reports").select("*, logs(activity_id, day, value, user_id, points)")
        .or(`status.in.(open,admin_review),resolved_at.gte."${since}"`).order("created_at", { ascending: false }),
      s.rpc("my_votes"),
      s.rpc("reports_left_today"),
    ]);
    setLogs(l.data ?? []);
    setAdjustments(a.data ?? []);
    setFreezes(f.data ?? []);
    setReports((r.data as ReportWithLog[]) ?? []);
    const votes: Record<string, string> = {};
    for (const x of (v.data ?? []) as { report_id: string; round: number; vote: string }[]) votes[`${x.report_id}:${x.round}`] = x.vote;
    setMyVotes(votes);
    if (typeof n.data === "number") setLeft(n.data);
  }, [from, today]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const member = (id: string) => members.find((m) => m.id === id);
  const act = (id: string) => activities.find((a) => a.id === id);
  const catOf = (a?: Activity) => categories.find((c) => c.id === a?.category_id);

  const groups = useMemo(() => {
    const days = [today, addDays(today, -1), addDays(today, -2)];
    return days.map((d) => {
      const byUser = new Map<string, Log[]>();
      for (const l of logs ?? []) if (l.day === d) byUser.set(l.user_id, [...(byUser.get(l.user_id) ?? []), l]);
      return {
        day: d,
        users: [...byUser.entries()].sort((a, b) => b[1][0].created_at.localeCompare(a[1][0].created_at)),
        adj: adjustments.filter((a) => a.day === d),
        frozen: freezes.filter((f) => d >= f.start_day && d <= f.end_day),
      };
    });
  }, [logs, adjustments, freezes, today]);

  const open = reports.filter((r) => r.status === "open" || r.status === "admin_review");
  const closed = reports.filter((r) => r.status !== "open" && r.status !== "admin_review");
  const openFor = (logId: string) => open.find((r) => r.log_id === logId);

  const report = async () => {
    if (!picked) return;
    setBusy(true);
    const { error } = await sb().rpc("create_report", { p_log: picked.id, p_note: note });
    setBusy(false);
    if (error) return toast.err(errMsg(error));
    toast.ok("Reported. The squad votes now.");
    setPicked(null); setNote("");
    load();
  };

  const vote = async (r: Report, v: "remove" | "keep") => {
    setMyVotes((s) => ({ ...s, [`${r.id}:${r.round}`]: v }));
    const { error } = await sb().rpc("cast_vote", { p_report: r.id, p_vote: v });
    if (error) toast.err(errMsg(error));
    load();
  };

  const valueText = (a: Activity | undefined, l: Pick<Log, "value">) =>
    !a ? "" : a.kind === "count" || a.kind === "band" ? fmtCount(a, l.value) : a.kind === "choice" ? a.options?.[l.value - 1]?.label ?? "" : "";

  return (
    <div className="rise">
      <PageHeader title="Squad Feed" sub={`Something look off? Tap it to report. ${left} report${left === 1 ? "" : "s"} left today.`}
        right={<button onClick={load} className="grid h-11 w-11 place-items-center rounded-2xl bg-white/[0.07]" aria-label="Refresh"><RefreshCw className="h-5 w-5" /></button>} />

      {/* Open votes */}
      {open.length > 0 && (
        <section className="mb-6 space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-extrabold"><Gavel className="h-5 w-5 text-amber-300" /> Open votes</h2>
          {open.map((r) => {
            const a = act(r.logs?.activity_id ?? "");
            const c = catOf(a);
            const target = member(r.reported_user_id);
            const myVote = myVotes[`${r.id}:${r.round}`];
            const eligible = members.length - 1;
            const isMine = r.reported_user_id === me.id;
            return (
              <div key={r.id} className="card overflow-hidden" style={{ borderColor: "rgba(250,204,21,.25)" }}>
                <div className="flex items-center gap-3 p-4 pb-3">
                  <Avatar name={target?.display_name ?? "?"} url={target?.avatar_url} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-bold">{target?.display_name}&apos;s {a?.name ?? "entry"}
                      {r.logs && <span className="font-semibold text-mute"> · {dayLabel(r.logs.day, today)}</span>}</p>
                    <p className="text-xs text-mute">Reported by {member(r.reporter_id)?.display_name} · {timeAgo(r.created_at)}</p>
                  </div>
                  {c && a && <div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: `${c.color_from}26`, color: c.color_from }}><Icon name={a.icon} className="h-5 w-5" /></div>}
                </div>
                <p className="mx-4 rounded-2xl bg-white/[0.05] px-3 py-2 text-sm text-soft">&ldquo;{r.note}&rdquo;</p>
                <div className="flex items-center justify-between px-4 pt-3 text-xs font-bold text-mute">
                  <span>{r.status === "admin_review" ? "Tied twice · admin decides" : `${r.remove_votes + r.keep_votes} of ${eligible} voted${r.round > 1 ? " · REVOTE" : ""}`}</span>
                  {r.status === "open" && <span>{timeLeft(r.closes_at)}</span>}
                </div>
                {r.status === "open" && (isMine ? (
                  <p className="px-4 pt-2 pb-4 text-sm text-amber-200">Your entry is under review. Everyone else votes.</p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 p-4 pt-3">
                    <button onClick={() => vote(r, "remove")} className="btn py-3 text-sm"
                      style={myVote === "remove" ? { background: "#f43f5e", color: "#fff" } : { background: "rgba(244,63,94,.12)", color: "#fb7185" }}>
                      <ThumbsDown className="h-4 w-4" /> Remove it
                    </button>
                    <button onClick={() => vote(r, "keep")} className="btn py-3 text-sm"
                      style={myVote === "keep" ? { background: "#10b981", color: "#fff" } : { background: "rgba(16,185,129,.12)", color: "#34d399" }}>
                      <ThumbsUp className="h-4 w-4" /> Keep it
                    </button>
                  </div>
                ))}
                {r.status === "admin_review" && <div className="h-4" />}
              </div>
            );
          })}
        </section>
      )}

      {/* Activity */}
      {!logs ? (
        <div className="grid h-60 place-items-center"><Spinner /></div>
      ) : logs.length === 0 && adjustments.length === 0 ? (
        <Empty icon="🦗" title="Quiet in here" sub="Nobody has logged anything in the last 3 days. Be the first." />
      ) : (
        groups.map((g) => (g.users.length || g.adj.length || g.frozen.length) ? (
          <section key={g.day} className="mb-6">
            <h2 className="mb-2 px-1 text-sm font-extrabold tracking-wider text-mute uppercase">{dayLabel(g.day, today)}</h2>
            <div className="space-y-3">
              {g.frozen.map((f) => (
                <div key={f.id} className="flex items-center gap-3 rounded-2xl border border-sky-300/20 bg-sky-400/10 px-4 py-3 text-sm">
                  <Snowflake className="h-5 w-5 text-sky-300" />
                  <p className="flex-1"><b>{member(f.user_id)?.display_name}</b> is frozen <span className="text-mute">({rangeLabel(f)})</span></p>
                </div>
              ))}
              {g.adj.map((a) => (
                <div key={a.id} className="flex items-center gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm">
                  <ShieldAlert className="h-5 w-5 shrink-0 text-amber-300" />
                  <p className="flex-1"><b>Admin</b> {fmtPoints(a.points)} to <b>{member(a.user_id)?.display_name}</b>: <span className="text-soft">{a.reason}</span></p>
                </div>
              ))}
              {g.users.map(([uid, items]) => {
                const m = member(uid);
                return (
                  <div key={uid} className="card p-4">
                    <Link href={`/u/${m?.username}`} className="flex items-center gap-3">
                      <Avatar name={m?.display_name ?? "?"} url={m?.avatar_url} size={38} />
                      <p className="flex-1 font-bold">{m?.display_name}{uid === me.id && <span className="ml-1.5 text-xs text-brand">you</span>}</p>
                      <span className="text-xs text-mute">{timeAgo(items[0].updated_at)}</span>
                    </Link>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {items.map((l) => {
                        const a = act(l.activity_id);
                        const c = catOf(a);
                        const underVote = !!openFor(l.id);
                        return (
                          <button key={l.id} onClick={() => setPicked(l)}
                            className={`flex items-center gap-1.5 rounded-full py-1.5 pr-3 pl-2 text-xs font-bold transition active:scale-95 ${l.voided ? "line-through opacity-50" : ""}`}
                            style={{ background: `${c?.color_from ?? "#fff"}1f`, color: c?.color_from }}>
                            <Icon name={a?.icon ?? ""} className="h-3.5 w-3.5" />
                            <span className="text-white">{a?.name}{valueText(a, l) && ` · ${valueText(a, l)}`}</span>
                            <span>{fmtPoints(l.points)}</span>
                            {underVote && <Flag className="h-3 w-3 text-amber-300" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null)
      )}

      {/* Recent verdicts */}
      {closed.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-2 px-1 text-sm font-extrabold tracking-wider text-mute uppercase">Recent verdicts</h2>
          <div className="card divide-y divide-white/[0.06]">
            {closed.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span className="text-lg">{r.status === "removed" ? "❌" : "✅"}</span>
                <p className="flex-1">
                  <b>{member(r.reported_user_id)?.display_name}</b>&apos;s {act(r.logs?.activity_id ?? "")?.name ?? "entry"}
                  <span className="block text-xs text-mute">{r.outcome_note}</span>
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Entry sheet */}
      <Sheet open={!!picked} onClose={() => { setPicked(null); setNote(""); }} title="Entry">
        {picked && (() => {
          const a = act(picked.activity_id);
          const c = catOf(a);
          const m = member(picked.user_id);
          const own = picked.user_id === me.id;
          const existing = openFor(picked.id);
          const tooOld = picked.day < addDays(today, -6);
          return (
            <div>
              <div className="flex items-center gap-3 rounded-2xl bg-white/[0.05] p-3">
                <div className="grid h-12 w-12 place-items-center rounded-2xl text-white" style={{ background: `linear-gradient(135deg, ${c?.color_from}, ${c?.color_to})` }}>
                  <Icon name={a?.icon ?? ""} className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <p className="font-extrabold">{a?.name} {valueText(a, picked) && <span className="text-mute">· {valueText(a, picked)}</span>}</p>
                  <p className="text-sm text-mute">{m?.display_name} · {dayLabel(picked.day, today)} · {fmtPoints(picked.points)} pts</p>
                </div>
              </div>
              {picked.voided ? (
                <p className="mt-4 text-sm text-rose-300">This entry was removed by a vote.</p>
              ) : own ? (
                <p className="mt-4 text-sm text-mute">This is your entry. Edit it on the Today tab.</p>
              ) : existing ? (
                <p className="mt-4 text-sm text-amber-200">Already under vote. Cast yours in Open votes above.</p>
              ) : tooOld ? (
                <p className="mt-4 text-sm text-mute">Too old to report.</p>
              ) : left <= 0 ? (
                <p className="mt-4 text-sm text-mute">You&apos;ve used all your reports for today. Try again tomorrow.</p>
              ) : (
                <div className="mt-4">
                  <label className="text-sm font-bold">Why does this look wrong?</label>
                  <textarea className="field mt-2 min-h-24 resize-none" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)}
                    placeholder="e.g. We were together all evening, no gym happened." />
                  <p className="mt-2 text-xs text-mute">
                    Everyone except {m?.display_name} votes (anonymously) within 24h. Your report counts as a &ldquo;remove&rdquo; vote.
                    A tie means one revote; a second tie goes to the admin. {left} of 3 reports left today.
                  </p>
                  <button className="btn btn-danger mt-4 w-full" disabled={busy || note.trim().length < 2} onClick={report}>
                    <Flag className="h-4 w-4" /> {busy ? "Reporting…" : "Report and start a vote"}
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </Sheet>
    </div>
  );
}
