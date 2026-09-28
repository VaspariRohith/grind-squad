import type { Activity, Category, Log } from "./types";

/** Same formula as the database's activity_points(). Used for instant UI updates. */
export function activityPoints(a: Activity, value: number, negative: boolean): number {
  const sign = negative ? -1 : 1;
  if (value <= 0) return 0;
  if (a.kind === "check") return sign * Math.abs(a.points);
  if (a.kind === "count") {
    const v = Math.min(value, a.max_value ?? value);
    return sign * Math.abs(a.points) * Math.floor(v / (a.step || 1));
  }
  if (a.kind === "band") {
    // the highest band whose "from" the value has reached
    const band = [...(a.options ?? [])].filter((o) => (o.from ?? 0) <= value).sort((x, y) => (y.from ?? 0) - (x.from ?? 0))[0];
    return band ? sign * Math.abs(band.points) : 0;
  }
  const opt = a.options?.[value - 1]; // choice values start at 1
  return opt ? sign * Math.abs(opt.points) : 0;
}

export type DayScore = {
  total: number;
  byCategory: Record<string, { points: number; raw: number; cap: number }>;
  maxPositive: number;
};

/** Daily score with per-category caps (same rules as daily_points() in SQL). */
export function dayScore(logs: Log[], categories: Category[], adjustments = 0): DayScore {
  const byCategory: DayScore["byCategory"] = {};
  for (const c of categories) byCategory[c.id] = { points: 0, raw: 0, cap: c.daily_cap };
  for (const l of logs) {
    if (l.voided || !byCategory[l.category_id]) continue;
    byCategory[l.category_id].raw += l.points;
  }
  let total = adjustments;
  for (const c of categories) {
    const b = byCategory[c.id];
    b.points = c.is_negative ? Math.max(b.raw, -c.daily_cap) : Math.min(b.raw, c.daily_cap);
    total += b.points;
  }
  const maxPositive = categories.filter((c) => !c.is_negative).reduce((s, c) => s + c.daily_cap, 0);
  return { total, byCategory, maxPositive };
}

export const fmtPoints = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export const fmtCount = (a: Activity, v: number) => {
  if (a.unit === "min") {
    const h = Math.floor(v / 60);
    const m = v % 60;
    return h ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
  }
  if (a.unit === "k") return `${v}k`;
  return `${v} ${a.unit ?? ""}${v === 1 || !a.unit ? "" : "s"}`.trim();
};

/** "30 min", "1k steps", "serving" — what one step of a counter means. */
export const stepLabel = (a: Activity) => {
  if (a.unit === "min") return a.step >= 60 && a.step % 60 === 0 ? `${a.step / 60}h` : `${a.step} min`;
  if (a.unit === "k") return `${a.step}k steps`;
  return a.step === 1 ? (a.unit ?? "") : `${a.step} ${a.unit ?? ""}s`;
};
