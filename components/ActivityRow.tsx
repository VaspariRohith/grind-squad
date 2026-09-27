"use client";

import { Minus, Plus } from "lucide-react";
import Icon from "./Icon";
import { Toggle } from "./ui";
import type { Activity, Category } from "@/lib/types";
import { activityPoints, fmtCount, fmtPoints } from "@/lib/scoring";

export default function ActivityRow({ a, cat, value, voided, disabled, onChange }: {
  a: Activity; cat: Category; value: number; voided?: boolean; disabled?: boolean; onChange: (v: number) => void;
}) {
  const pts = a.kind === "check" ? activityPoints(a, 1, cat.is_negative) : activityPoints(a, value, cat.is_negative);
  const tint = cat.is_negative ? "#f43f5e" : cat.color_from;
  const lit = value > 0;

  return (
    <div className="rounded-2xl px-3 py-3 transition-colors"
      style={{ background: lit && !voided ? `${tint}14` : "transparent" }}>
      <div className="flex items-center gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl transition-colors"
          style={{ background: lit ? `${tint}2a` : "rgba(255,255,255,0.06)", color: lit ? tint : "#8b8ba3" }}>
          <Icon name={a.icon} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`font-bold leading-tight ${voided ? "text-mute line-through" : ""}`}>{a.name}</p>
            {a.kind === "check" && (
              <span className="shrink-0 text-xs font-extrabold tabular-nums"
                style={{ color: cat.is_negative ? "#fb7185" : lit ? tint : "#6b6b85" }}>
                {fmtPoints(pts)}
              </span>
            )}
          </div>
          {voided ? <p className="text-xs text-rose-400">Removed by a squad vote</p>
            : a.kind === "count" ? (
              <p className="truncate text-xs text-mute">
                {value > 0 && <b style={{ color: cat.is_negative ? "#fb7185" : tint }}>{fmtPoints(pts)} · </b>}
                {cat.is_negative ? "−" : "+"}{a.points} per {a.unit === "min" ? `${a.step} min` : a.unit}
              </p>
            ) : a.hint && <p className="truncate text-xs text-mute">{a.hint}</p>}
        </div>

        {a.kind === "check" && (
          <Toggle on={value > 0} disabled={disabled || voided}
            from={cat.is_negative ? "#f43f5e" : cat.color_from} to={cat.is_negative ? "#b91c1c" : cat.color_to}
            onChange={(on) => onChange(on ? 1 : 0)} />
        )}

        {a.kind === "count" && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button type="button" disabled={disabled || voided || value <= 0} onClick={() => onChange(Math.max(0, value - a.step))}
              className="grid h-9 w-9 place-items-center rounded-full bg-white/10 transition active:scale-90 disabled:opacity-30" aria-label="Less">
              <Minus className="h-4 w-4" strokeWidth={3} />
            </button>
            <span className="min-w-[3.25rem] text-center text-sm font-extrabold tabular-nums">{value > 0 ? fmtCount(a, value) : "–"}</span>
            <button type="button" disabled={disabled || voided || value >= (a.max_value ?? 10) * 3} onClick={() => onChange(value + a.step)}
              className="grid h-9 w-9 place-items-center rounded-full text-white transition active:scale-90 disabled:opacity-30" aria-label="More"
              style={{ background: `linear-gradient(135deg, ${cat.is_negative ? "#f43f5e" : cat.color_from}, ${cat.is_negative ? "#b91c1c" : cat.color_to})` }}>
              <Plus className="h-4 w-4" strokeWidth={3} />
            </button>
          </div>
        )}
      </div>

      {a.kind === "choice" && a.options && (
        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
          {a.options.map((o, i) => {
            const sel = value === i + 1;
            return (
              <button key={o.label} type="button" disabled={disabled || voided} onClick={() => onChange(sel ? 0 : i + 1)}
                className="rounded-xl py-2 text-center transition active:scale-95 disabled:opacity-40"
                style={sel ? { background: `linear-gradient(135deg, ${cat.color_from}, ${cat.color_to})`, boxShadow: `0 6px 18px -8px ${cat.color_to}` }
                  : { background: "rgba(255,255,255,0.06)" }}>
                <div className="text-sm font-extrabold">{o.label}</div>
                <div className={`text-[11px] font-bold ${sel ? "text-white/85" : "text-mute"}`}>+{o.points}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
