// All dates are "YYYY-MM-DD" strings in the app's timezone (set in the DB).
// We do date math in UTC so the browser's own timezone never shifts a day.

const parse = (iso: string) => new Date(iso + "T00:00:00Z");
const fmt = (d: Date) => d.toISOString().slice(0, 10);

export const addDays = (iso: string, n: number) => {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
};

export const weekStart = (iso: string) => {
  const d = parse(iso);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return fmt(d);
};
export const monthStart = (iso: string) => iso.slice(0, 8) + "01";
export const yearStart = (iso: string) => iso.slice(0, 5) + "01-01";

export const daysLeftInMonth = (iso: string) => {
  const d = parse(iso);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return last.getUTCDate() - d.getUTCDate();
};

export const niceDate = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "short", day: "numeric" }) =>
  parse(iso).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

export const dayLabel = (iso: string, today: string) => {
  if (iso === today) return "Today";
  if (iso === addDays(today, -1)) return "Yesterday";
  return niceDate(iso, { weekday: "short", month: "short", day: "numeric" });
};

export const monthName = (period: string) => {
  // "2026-10" -> "October 2026", "2026" -> "2026"
  if (period.length === 4) return period;
  return parse(period + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

export const timeAgo = (ts: string) => {
  const s = Math.max(1, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const timeLeft = (ts: string) => {
  const s = Math.floor((new Date(ts).getTime() - Date.now()) / 1000);
  if (s <= 0) return "closing…";
  if (s < 3600) return `${Math.ceil(s / 60)}m left`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m left`;
};

export const greeting = () => {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};
