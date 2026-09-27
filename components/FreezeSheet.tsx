"use client";

import { useState } from "react";
import { Snowflake, Trash2 } from "lucide-react";
import { useApp } from "./AppProvider";
import { Sheet, toast } from "./ui";
import { addDays, niceDate } from "@/lib/dates";
import { errMsg, sb } from "@/lib/supabase";
import type { Freeze } from "@/lib/types";

const STATUS_STYLE: Record<Freeze["status"], { bg: string; fg: string; label: string }> = {
  pending: { bg: "rgba(250,204,21,.14)", fg: "#fde047", label: "Waiting for admin" },
  approved: { bg: "rgba(125,211,252,.15)", fg: "#7dd3fc", label: "Approved" },
  denied: { bg: "rgba(244,63,94,.14)", fg: "#fb7185", label: "Denied" },
};

export const rangeLabel = (f: { start_day: string; end_day: string }) =>
  f.start_day === f.end_day ? niceDate(f.start_day, { weekday: "short", month: "short", day: "numeric" })
    : `${niceDate(f.start_day, { month: "short", day: "numeric" })} – ${niceDate(f.end_day, { month: "short", day: "numeric" })}`;

export default function FreezeSheet({ open, onClose, freezes, onChanged }: {
  open: boolean; onClose: () => void; freezes: Freeze[]; onChanged: () => void;
}) {
  const { today } = useApp();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (end < start) return toast.err("End date is before start date");
    setBusy(true);
    const { error } = await sb().rpc("request_freeze", { p_start: start, p_end: end, p_reason: reason });
    setBusy(false);
    if (error) return toast.err(errMsg(error));
    toast.ok("Freeze requested. The admin will review it.");
    setReason("");
    onChanged();
  };

  const cancel = async (id: string) => {
    const { error } = await sb().from("freezes").delete().eq("id", id);
    if (error) return toast.err(errMsg(error));
    onChanged();
  };

  return (
    <Sheet open={open} onClose={onClose} title={<span className="flex items-center gap-2"><Snowflake className="h-6 w-6 text-sky-300" /> Request a freeze</span>}>
      <p className="mb-4 text-sm text-soft">
        A frozen day counts as zero: no points, no penalties, and your streak stays safe.
        One day for a cheat day, or a range for a trip. The admin approves after checking with the squad.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-bold text-mute">From
          <input type="date" className="field mt-1" value={start} min={addDays(today, -1)}
            onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} />
        </label>
        <label className="text-xs font-bold text-mute">To
          <input type="date" className="field mt-1" value={end} min={start} max={addDays(start, 30)} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <input className="field mt-3" placeholder="Reason (cheat day, trip to Austin…)" maxLength={200}
        value={reason} onChange={(e) => setReason(e.target.value)} />
      <button className="btn btn-primary mt-4 w-full" disabled={busy} onClick={submit}
        style={{ background: "linear-gradient(135deg,#38bdf8,#6366f1)", boxShadow: "0 10px 30px -10px #38bdf8" }}>
        {busy ? "Sending…" : "Send request"}
      </button>

      {freezes.length > 0 && (
        <div className="mt-6">
          <h4 className="mb-2 text-sm font-bold text-mute">Your freezes</h4>
          <div className="space-y-2">
            {freezes.map((f) => {
              const st = STATUS_STYLE[f.status];
              return (
                <div key={f.id} className="flex items-center gap-3 rounded-2xl bg-white/[0.05] px-3 py-2.5">
                  <div className="flex-1">
                    <p className="font-bold">{rangeLabel(f)}</p>
                    {f.reason && <p className="text-xs text-mute">{f.reason}</p>}
                  </div>
                  <span className="chip" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
                  {f.status === "pending" && (
                    <button onClick={() => cancel(f.id)} className="p-1 text-mute" aria-label="Cancel request"><Trash2 className="h-4 w-4" /></button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Sheet>
  );
}
