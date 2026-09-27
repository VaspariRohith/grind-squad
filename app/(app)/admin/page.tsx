"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Check, Copy, Download, Gavel, KeyRound, Plus, Share, ShieldCheck, Snowflake, Ticket, Trash2, UserX, X, Scale, Users, SlidersHorizontal,
} from "lucide-react";
import { useApp } from "@/components/AppProvider";
import Icon from "@/components/Icon";
import { rangeLabel } from "@/components/FreezeSheet";
import { Avatar, PageHeader, Sheet, Toggle, toast } from "@/components/ui";
import { dayLabel, niceDate, timeAgo } from "@/lib/dates";
import { fmtPoints } from "@/lib/scoring";
import { errMsg, sb } from "@/lib/supabase";
import { copyText } from "@/lib/clipboard";
import type { Adjustment, Freeze, InviteCode, Log, Profile, Report } from "@/lib/types";

type Tab = "codes" | "points" | "freezes" | "reports" | "members" | "rules";
const TABS: { id: Tab; label: string; icon: typeof Ticket }[] = [
  { id: "codes", label: "Invites", icon: Ticket },
  { id: "points", label: "Points", icon: Scale },
  { id: "freezes", label: "Freezes", icon: Snowflake },
  { id: "reports", label: "Reports", icon: Gavel },
  { id: "members", label: "Members", icon: Users },
  { id: "rules", label: "Rules", icon: SlidersHorizontal },
];

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("codes");
  const [counts, setCounts] = useState<{ freezes: number; reports: number }>({ freezes: 0, reports: 0 });

  const refreshCounts = useCallback(async () => {
    const [f, r] = await Promise.all([
      sb().from("freezes").select("id", { count: "exact", head: true }).eq("status", "pending"),
      sb().from("reports").select("id", { count: "exact", head: true }).in("status", ["open", "admin_review"]),
    ]);
    setCounts({ freezes: f.count ?? 0, reports: r.count ?? 0 });
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshCounts();
  }, [refreshCounts, tab]);

  return (
    <div className="rise">
      <PageHeader title={<span className="flex items-center gap-2"><ShieldCheck className="h-8 w-8 text-emerald-400" /> Admin</span>} sub="With great power comes great group-chat drama." />
      <div className="no-scrollbar -mx-4 mb-5 flex gap-2 overflow-x-auto px-4">
        {TABS.map((t) => {
          const badge = t.id === "freezes" ? counts.freezes : t.id === "reports" ? counts.reports : 0;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition ${tab === t.id ? "bg-white text-black" : "bg-white/[0.07] text-soft"}`}>
              <t.icon className="h-4 w-4" /> {t.label}
              {badge > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[11px] text-white">{badge}</span>}
            </button>
          );
        })}
      </div>
      {tab === "codes" && <Invites />}
      {tab === "points" && <Points />}
      {tab === "freezes" && <Freezes onChange={refreshCounts} />}
      {tab === "reports" && <Reports onChange={refreshCounts} />}
      {tab === "members" && <Members />}
      {tab === "rules" && <Rules />}
    </div>
  );
}

/* ---------------------------------------------------------------- */
function MemberPicker({ value, onChange }: { value: string | null; onChange: (id: string) => void }) {
  const { members } = useApp();
  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-1">
      {members.map((m) => (
        <button key={m.id} onClick={() => onChange(m.id)} className="flex w-16 shrink-0 flex-col items-center gap-1">
          <Avatar name={m.display_name} url={m.avatar_url} size={48} ring={value === m.id ? "#34d399" : undefined} />
          <span className={`w-full truncate text-center text-[11px] font-bold ${value === m.id ? "text-white" : "text-mute"}`}>{m.display_name}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------------- Invite codes ---------------- */
function Invites() {
  const { members } = useApp();
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [filter, setFilter] = useState<"unused" | "used" | "all">("unused");
  const [noteFor, setNoteFor] = useState<InviteCode | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const { data } = await sb().from("invite_codes").select("*").order("created_at", { ascending: false }).order("code");
    setCodes(data ?? []);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const unused = codes.filter((c) => !c.used_by && !c.revoked);
  const shown = codes.filter((c) => filter === "all" ? true : filter === "used" ? !!c.used_by : !c.used_by && !c.revoked);

  const link = (code: string) => `${location.origin}/signup?code=${code}`;
  const [manual, setManual] = useState<string | null>(null); // shown when copying is blocked
  const inviteText = (c: InviteCode) => `You're invited to Grind Squad. Sign up here: ${link(c.code)}  (invite code: ${c.code})`;
  const share = async (c: InviteCode) => {
    const text = inviteText(c);
    if (navigator.share) {
      try { await navigator.share({ text }); return; }
      catch (e) { if ((e as Error).name === "AbortError") return; /* else fall back to copy */ }
    }
    if (await copyText(text)) toast.ok("Invite message copied");
    else setManual(text);
  };
  const copy = async (code: string) => {
    if (await copyText(code)) toast.ok(`${code} copied`);
    else setManual(code);
  };

  const generate = async () => {
    const { error } = await sb().rpc("admin_generate_invites", { p_count: 10, p_note: null });
    if (error) return toast.err(errMsg(error));
    toast.ok("10 new codes added at the top"); setFilter("unused"); load();
  };
  const setRevoked = async (c: InviteCode, revoked: boolean) => {
    const { error } = await sb().from("invite_codes").update({ revoked }).eq("code", c.code);
    if (error) return toast.err(errMsg(error));
    load();
  };
  const saveNote = async () => {
    if (!noteFor) return;
    const { error } = await sb().from("invite_codes").update({ note: note.trim() || null }).eq("code", noteFor.code);
    if (error) return toast.err(errMsg(error));
    setNoteFor(null); load();
  };
  const csv = () => {
    const rows = [["code", "status", "note", "used_by", "used_at", "signup_link"],
      ...codes.map((c) => [c.code, c.revoked ? "killed" : c.used_by ? "used" : "unused", c.note ?? "",
        members.find((m) => m.id === c.used_by)?.username ?? "", c.used_at ?? "", link(c.code)])];
    const blob = new Blob([rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "grind-squad-invite-codes.csv"; a.click();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {[["Unused", unused.length, "#34d399"], ["Used", codes.filter((c) => c.used_by).length, "#60a5fa"], ["Killed", codes.filter((c) => c.revoked && !c.used_by).length, "#fb7185"]].map(([l, n, col]) => (
          <div key={l as string} className="card p-3 text-center">
            <p className="text-2xl font-black" style={{ color: col as string }}>{n as number}</p>
            <p className="text-xs font-bold text-mute">{l as string}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button className="btn btn-primary py-3 text-sm" onClick={generate}><Plus className="h-4 w-4" /> 10 more codes</button>
        <button className="btn btn-ghost py-3 text-sm" onClick={csv}><Download className="h-4 w-4" /> Download CSV</button>
      </div>
      <div className="flex gap-2">
        {(["unused", "used", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`chip capitalize ${filter === f ? "!bg-white !text-black" : ""}`}>{f}</button>
        ))}
      </div>
      <div className="space-y-2">
        {shown.map((c) => {
          const who = members.find((m) => m.id === c.used_by);
          return (
            <div key={c.code} className={`card flex items-center gap-2 p-3 ${c.revoked ? "opacity-50" : ""}`}>
              <button className="min-w-0 flex-1 text-left" onClick={() => { setNoteFor(c); setNote(c.note ?? ""); }}>
                <p className={`font-mono text-[15px] font-bold tracking-wide ${c.revoked ? "line-through" : ""}`}>{c.code}</p>
                <p className="truncate text-xs text-mute">
                  {who ? `Used by @${who.username} · ${timeAgo(c.used_at!)}` : c.revoked ? "Killed" : c.note ? `For ${c.note}` : "Tap to add who it's for"}
                </p>
              </button>
              {!c.used_by && !c.revoked && (
                <>
                  <button onClick={() => copy(c.code)} className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.07]" aria-label="Copy code"><Copy className="h-4 w-4" /></button>
                  <button onClick={() => share(c)} className="grid h-9 w-9 place-items-center rounded-xl bg-sky-400/15 text-sky-300" aria-label="Share invite"><Share className="h-4 w-4" /></button>
                  <button onClick={() => setRevoked(c, true)} className="grid h-9 w-9 place-items-center rounded-xl bg-rose-500/15 text-rose-400" aria-label="Kill code"><X className="h-4 w-4" /></button>
                </>
              )}
              {c.revoked && !c.used_by && (
                <button onClick={() => setRevoked(c, false)} className="chip">Revive</button>
              )}
            </div>
          );
        })}
      </div>
      <Sheet open={!!manual} onClose={() => setManual(null)} title="Copy this">
        <p className="mb-3 text-sm text-soft">This browser blocked automatic copying. Press and hold the text below, then Select All → Copy.</p>
        <textarea readOnly className="field min-h-28 resize-none font-mono text-sm" value={manual ?? ""}
          onFocus={(e) => e.currentTarget.select()} />
      </Sheet>
      <Sheet open={!!noteFor} onClose={() => setNoteFor(null)} title={<span className="font-mono">{noteFor?.code}</span>}>
        <label className="text-xs font-bold text-mute">Who is this code for?
          <input className="field mt-1" placeholder="e.g. Rahul" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="btn btn-primary mt-4 w-full" onClick={saveNote}>Save</button>
      </Sheet>
    </div>
  );
}

/* ---------------- Points ---------------- */
function Points() {
  const { members, today } = useApp();
  const [who, setWho] = useState<string | null>(null);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState("");
  const [day, setDay] = useState(today);
  const [list, setList] = useState<Adjustment[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await sb().from("adjustments").select("*").order("created_at", { ascending: false }).limit(30);
    setList(data ?? []);
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const submit = async () => {
    if (!who) return toast.err("Pick a member");
    if (!amount) return toast.err("Pick an amount");
    if (reason.trim().length < 2) return toast.err("Add a reason, everyone can see it");
    setBusy(true);
    const { error } = await sb().from("adjustments").insert({ user_id: who, points: amount, reason: reason.trim(), day });
    setBusy(false);
    if (error) return toast.err(errMsg(error));
    toast.ok(`${fmtPoints(amount)} applied`);
    setAmount(0); setReason(""); load();
  };
  const undo = async (id: string) => {
    const { error } = await sb().from("adjustments").delete().eq("id", id);
    if (error) return toast.err(errMsg(error));
    load();
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-4 p-4">
        <div>
          <p className="mb-2 text-sm font-bold">Who</p>
          <MemberPicker value={who} onChange={setWho} />
        </div>
        <div>
          <p className="mb-2 text-sm font-bold">How many points</p>
          <div className="grid grid-cols-4 gap-2">
            {[-50, -20, -10, -5, 5, 10, 20, 50].map((n) => (
              <button key={n} onClick={() => setAmount(n)} className="rounded-xl py-2.5 text-sm font-extrabold transition active:scale-95"
                style={amount === n ? { background: n < 0 ? "#f43f5e" : "#10b981", color: "#fff" }
                  : { background: n < 0 ? "rgba(244,63,94,.12)" : "rgba(16,185,129,.12)", color: n < 0 ? "#fb7185" : "#34d399" }}>
                {fmtPoints(n)}
              </button>
            ))}
          </div>
          <input className="field mt-2" type="number" inputMode="numeric" placeholder="Or type any amount (e.g. -15)"
            value={amount || ""} onChange={(e) => setAmount(parseInt(e.target.value) || 0)} />
        </div>
        <input className="field" placeholder="Reason (shown in the feed)" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
        <label className="block text-xs font-bold text-mute">Counts on day
          <input className="field mt-1" type="date" max={today} value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <button className="btn btn-primary w-full" disabled={busy} onClick={submit}>Apply {amount ? fmtPoints(amount) : ""}</button>
      </div>
      <h3 className="px-1 text-sm font-extrabold tracking-wider text-mute uppercase">Recent adjustments</h3>
      <div className="space-y-2">
        {list.length === 0 && <p className="px-1 text-sm text-mute">None yet.</p>}
        {list.map((a) => {
          const m = members.find((x) => x.id === a.user_id);
          return (
            <div key={a.id} className="card flex items-center gap-3 p-3">
              <Avatar name={m?.display_name ?? "?"} url={m?.avatar_url} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{m?.display_name} <span style={{ color: a.points < 0 ? "#fb7185" : "#34d399" }}>{fmtPoints(a.points)}</span></p>
                <p className="truncate text-xs text-mute">{a.reason} · {niceDate(a.day, { month: "short", day: "numeric" })}</p>
              </div>
              <button onClick={() => undo(a.id)} className="p-2 text-mute" aria-label="Undo"><Trash2 className="h-4 w-4" /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Freezes ---------------- */
function Freezes({ onChange }: { onChange: () => void }) {
  const { members, today } = useApp();
  const [list, setList] = useState<Freeze[]>([]);
  const [who, setWho] = useState<string | null>(null);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    const { data } = await sb().from("freezes").select("*").or(`status.eq.pending,end_day.gte.${today}`).order("start_day");
    setList(data ?? []);
    onChange();
  }, [today, onChange]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const decide = async (id: string, approve: boolean) => {
    const { error } = await sb().rpc("admin_decide_freeze", { p_id: id, p_approve: approve });
    if (error) return toast.err(errMsg(error));
    toast.ok(approve ? "Approved ❄️" : "Denied"); load();
  };
  const create = async () => {
    if (!who) return toast.err("Pick a member");
    const { error } = await sb().rpc("admin_create_freeze", { p_user: who, p_start: start, p_end: end, p_reason: reason });
    if (error) return toast.err(errMsg(error));
    toast.ok("Freeze added"); setReason(""); load();
  };
  const remove = async (id: string) => {
    const { error } = await sb().from("freezes").delete().eq("id", id);
    if (error) return toast.err(errMsg(error));
    load();
  };

  const pending = list.filter((f) => f.status === "pending");
  const active = list.filter((f) => f.status === "approved");
  const name = (id: string) => members.find((m) => m.id === id);

  return (
    <div className="space-y-4">
      <h3 className="px-1 text-sm font-extrabold tracking-wider text-mute uppercase">Waiting for you</h3>
      {pending.length === 0 && <p className="px-1 text-sm text-mute">No pending requests.</p>}
      {pending.map((f) => {
        const m = name(f.user_id);
        return (
          <div key={f.id} className="card p-4" style={{ borderColor: "rgba(125,211,252,.3)" }}>
            <div className="flex items-center gap-3">
              <Avatar name={m?.display_name ?? "?"} url={m?.avatar_url} size={40} />
              <div className="flex-1">
                <p className="font-bold">{m?.display_name}</p>
                <p className="text-sm text-sky-300">{rangeLabel(f)}</p>
              </div>
            </div>
            {f.reason && <p className="mt-2 rounded-xl bg-white/[0.05] px-3 py-2 text-sm text-soft">&ldquo;{f.reason}&rdquo;</p>}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn btn-danger py-2.5 text-sm" onClick={() => decide(f.id, false)}><X className="h-4 w-4" /> Deny</button>
              <button className="btn py-2.5 text-sm text-white" style={{ background: "linear-gradient(135deg,#38bdf8,#6366f1)" }} onClick={() => decide(f.id, true)}><Check className="h-4 w-4" /> Approve</button>
            </div>
          </div>
        );
      })}

      <h3 className="px-1 pt-2 text-sm font-extrabold tracking-wider text-mute uppercase">Active & upcoming</h3>
      {active.length === 0 && <p className="px-1 text-sm text-mute">Nobody is frozen.</p>}
      {active.map((f) => (
        <div key={f.id} className="card flex items-center gap-3 p-3">
          <Snowflake className="h-5 w-5 text-sky-300" />
          <p className="flex-1 text-sm"><b>{name(f.user_id)?.display_name}</b> · {rangeLabel(f)}{f.reason && <span className="text-mute"> · {f.reason}</span>}</p>
          <button onClick={() => remove(f.id)} className="p-2 text-mute" aria-label="Remove freeze"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}

      <div className="card space-y-3 p-4">
        <p className="font-bold">Freeze someone directly</p>
        <MemberPicker value={who} onChange={setWho} />
        <div className="grid grid-cols-2 gap-2">
          <input className="field" type="date" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} />
          <input className="field" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <input className="field" placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn btn-ghost w-full" onClick={create}><Snowflake className="h-4 w-4 text-sky-300" /> Add freeze</button>
      </div>
    </div>
  );
}

/* ---------------- Reports ---------------- */
type ReportWithLog = Report & { logs: Pick<Log, "activity_id" | "day" | "points"> | null };
function Reports({ onChange }: { onChange: () => void }) {
  const { members, activities, today } = useApp();
  const [list, setList] = useState<ReportWithLog[]>([]);
  const load = useCallback(async () => {
    await sb().rpc("resolve_due_reports");
    const { data } = await sb().from("reports").select("*, logs(activity_id, day, points)").order("created_at", { ascending: false }).limit(40);
    setList((data as ReportWithLog[]) ?? []);
    onChange();
  }, [onChange]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const decide = async (id: string, remove: boolean) => {
    const { error } = await sb().rpc("admin_decide_report", { p_id: id, p_remove: remove });
    if (error) return toast.err(errMsg(error));
    toast.ok(remove ? "Entry removed" : "Entry kept"); load();
  };

  const STATUS: Record<Report["status"], string> = {
    open: "Voting", admin_review: "Needs you", removed: "Removed", kept: "Kept", dismissed: "Dismissed",
  };

  return (
    <div className="space-y-3">
      <p className="px-1 text-sm text-mute">Ties go to you after a revote. You can also override any report.</p>
      {list.length === 0 && <p className="px-1 text-sm text-mute">No reports yet.</p>}
      {list.map((r) => {
        const m = members.find((x) => x.id === r.reported_user_id);
        const a = activities.find((x) => x.id === r.logs?.activity_id);
        const hot = r.status === "admin_review";
        return (
          <div key={r.id} className="card p-4" style={hot ? { borderColor: "rgba(250,204,21,.4)" } : undefined}>
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.07]"><Icon name={a?.icon ?? ""} className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{m?.display_name}&apos;s {a?.name}</p>
                <p className="text-xs text-mute">{r.logs ? dayLabel(r.logs.day, today) : ""} · by {members.find((x) => x.id === r.reporter_id)?.display_name} · {r.remove_votes}–{r.keep_votes}</p>
              </div>
              <span className="chip" style={hot ? { background: "rgba(250,204,21,.15)", color: "#fde047" } : undefined}>{STATUS[r.status]}</span>
            </div>
            <p className="mt-2 text-sm text-soft">&ldquo;{r.note}&rdquo;</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="btn btn-danger py-2 text-sm" onClick={() => decide(r.id, true)}>Remove entry</button>
              <button className="btn btn-ghost py-2 text-sm" onClick={() => decide(r.id, false)}>Keep entry</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------------- Members ---------------- */
function Members() {
  const { members, me, reload } = useApp();
  const [pwFor, setPwFor] = useState<Profile | null>(null);
  const [delFor, setDelFor] = useState<Profile | null>(null);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const call = async (body: object) => {
    const { data } = await sb().auth.getSession();
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
      body: JSON.stringify(body),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error);
  };

  const resetPw = async () => {
    if (!pwFor) return;
    setBusy(true);
    try { await call({ action: "reset_password", userId: pwFor.id, password: pw }); toast.ok(`New password set for @${pwFor.username}`); setPwFor(null); setPw(""); }
    catch (e) { toast.err(errMsg(e)); }
    setBusy(false);
  };
  const del = async () => {
    if (!delFor) return;
    setBusy(true);
    try { await call({ action: "delete", userId: delFor.id }); toast.ok(`@${delFor.username} removed`); setDelFor(null); setConfirm(""); await reload(); }
    catch (e) { toast.err(errMsg(e)); }
    setBusy(false);
  };
  const setAdmin = async (p: Profile, v: boolean) => {
    const { error } = await sb().rpc("admin_set_admin", { p_user: p.id, p_admin: v });
    if (error) return toast.err(errMsg(error));
    await reload();
  };

  return (
    <div className="space-y-2">
      {members.map((m) => (
        <div key={m.id} className="card p-3">
          <div className="flex items-center gap-3">
            <Avatar name={m.display_name} url={m.avatar_url} size={44} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{m.display_name}</p>
              <p className="text-xs text-mute">@{m.username} · joined {niceDate(m.created_at.slice(0, 10), { month: "short", day: "numeric" })}</p>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <Toggle on={m.is_admin} disabled={m.id === me.id} from="#34d399" to="#059669" onChange={(v) => setAdmin(m, v)} />
              <span className="text-[10px] font-bold text-mute">admin</span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn btn-ghost py-2 text-sm" onClick={() => setPwFor(m)}><KeyRound className="h-4 w-4" /> Reset password</button>
            <button className="btn btn-danger py-2 text-sm" disabled={m.id === me.id} onClick={() => setDelFor(m)}><UserX className="h-4 w-4" /> Remove</button>
          </div>
        </div>
      ))}

      <Sheet open={!!pwFor} onClose={() => setPwFor(null)} title={`Reset @${pwFor?.username}`}>
        <p className="mb-3 text-sm text-soft">Set a temporary password and send it to them. They can change it from their profile.</p>
        <input className="field" placeholder="New password (6+ characters)" value={pw} onChange={(e) => setPw(e.target.value)} />
        <button className="btn btn-primary mt-4 w-full" disabled={busy || pw.length < 6} onClick={resetPw}>Set password</button>
      </Sheet>
      <Sheet open={!!delFor} onClose={() => setDelFor(null)} title={`Remove @${delFor?.username}?`}>
        <p className="mb-3 text-sm text-soft">This deletes their account and all their logs, streaks and trophies. It can&apos;t be undone. Type their username to confirm.</p>
        <input className="field" placeholder={delFor?.username} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoCapitalize="none" />
        <button className="btn btn-danger mt-4 w-full" disabled={busy || confirm !== delFor?.username} onClick={del}>Remove forever</button>
      </Sheet>
    </div>
  );
}

/* ---------------- Rules ---------------- */
function Rules() {
  const { categories, activities, reload } = useApp();
  const [caps, setCaps] = useState<Record<string, number>>(() => Object.fromEntries(categories.map((c) => [c.id, c.daily_cap])));
  const [pts, setPts] = useState<Record<string, number>>(() => Object.fromEntries(activities.map((a) => [a.id, a.points])));
  const [on, setOn] = useState<Record<string, boolean>>(() => Object.fromEntries(activities.map((a) => [a.id, a.active])));
  const [busy, setBusy] = useState(false);

  const dirty = categories.some((c) => caps[c.id] !== c.daily_cap) ||
    activities.some((a) => pts[a.id] !== a.points || on[a.id] !== a.active);

  const save = async () => {
    setBusy(true);
    const s = sb();
    const jobs = [
      ...categories.filter((c) => caps[c.id] !== c.daily_cap).map((c) => s.from("categories").update({ daily_cap: caps[c.id] }).eq("id", c.id)),
      ...activities.filter((a) => pts[a.id] !== a.points || on[a.id] !== a.active)
        .map((a) => s.from("activities").update({ points: pts[a.id], active: on[a.id] }).eq("id", a.id)),
    ];
    const results = await Promise.all(jobs);
    setBusy(false);
    const err = results.find((r) => r.error)?.error;
    if (err) return toast.err(errMsg(err));
    await reload();
    toast.ok("Rules saved. New entries use them.");
  };

  return (
    <div className="space-y-4">
      <p className="px-1 text-sm text-mute">Changes apply to new entries. Past points stay as they were logged.</p>
      {categories.map((c) => (
        <div key={c.id} className="card p-3">
          <div className="flex items-center gap-3 px-1">
            <div className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: `linear-gradient(135deg, ${c.color_from}, ${c.color_to})` }}>
              <Icon name={c.icon} className="h-5 w-5" />
            </div>
            <p className="flex-1 font-extrabold">{c.name}</p>
            <span className="text-xs font-bold text-mute">{c.is_negative ? "max penalty" : "daily cap"}</span>
            <input className="field w-20 py-2 text-center" type="number" inputMode="numeric" value={caps[c.id]}
              onChange={(e) => setCaps({ ...caps, [c.id]: Math.max(1, parseInt(e.target.value) || 1) })} />
          </div>
          <div className="mt-2 space-y-1">
            {activities.filter((a) => a.category_id === c.id).map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-xl px-1 py-1.5">
                <p className={`flex-1 truncate text-sm font-semibold ${on[a.id] ? "" : "text-mute line-through"}`}>{a.name}</p>
                {a.kind === "choice" || a.kind === "band" ? (
                  <span className="text-xs text-mute">{a.options?.map((o) => o.points).join(" / ")}</span>
                ) : (
                  <>
                    <span className="text-xs text-mute">{a.kind === "count" ? `per ${a.step}${a.unit === "min" ? "m" : ` ${a.unit}`}` : ""}</span>
                    <input className="field w-16 py-1.5 text-center text-sm" type="number" inputMode="numeric" value={pts[a.id]}
                      onChange={(e) => setPts({ ...pts, [a.id]: Math.max(0, parseInt(e.target.value) || 0) })} />
                  </>
                )}
                <Toggle on={on[a.id]} onChange={(v) => setOn({ ...on, [a.id]: v })} from={c.color_from} to={c.color_to} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="sticky bottom-28 z-10">
        <button className="btn btn-primary w-full shadow-2xl" disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : dirty ? "Save changes" : "No changes"}</button>
      </div>
    </div>
  );
}
