import { Crown, Snail, Trophy } from "lucide-react";
import type { Award } from "@/lib/types";
import { monthName } from "@/lib/dates";

export const AWARD_STYLE = {
  month_champion: { from: "#FDE047", to: "#F59E0B", icon: Trophy, label: "Champion" },
  year_champion: { from: "#F0ABFC", to: "#8B5CF6", icon: Crown, label: "Champion of the year" },
  month_last: { from: "#A3A36B", to: "#6B4F2A", icon: Snail, label: "Last place" },
  year_last: { from: "#9CA38F", to: "#4B3A26", icon: Snail, label: "Last place of the year" },
} as const;

export default function AwardCard({ award, who, compact }: { award: Award; who?: string; compact?: boolean }) {
  const s = AWARD_STYLE[award.kind];
  const I = s.icon;
  return (
    <div className="relative overflow-hidden rounded-2xl p-3.5"
      style={{ background: `linear-gradient(135deg, ${s.from}26, ${s.to}14)`, border: `1px solid ${s.from}40` }}>
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-white"
          style={{ background: `linear-gradient(135deg, ${s.from}, ${s.to})`, boxShadow: `0 8px 20px -8px ${s.to}` }}>
          <I className="h-6 w-6" strokeWidth={2.3} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-extrabold leading-tight">{award.title}</p>
          <p className="truncate text-xs text-soft">
            {who ? <b className="text-white">{who}</b> : null}{who ? " · " : ""}{s.label} · {monthName(award.period)}
            {!compact && ` · ${award.points} pts`}
          </p>
        </div>
      </div>
    </div>
  );
}
