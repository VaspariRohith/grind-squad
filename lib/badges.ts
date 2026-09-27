export type BadgeShape =
  | "circle" | "hexagon" | "shield" | "diamond" | "octagon" | "star"
  | "burst" | "crest" | "gem" | "flower" | "crown";

export type StreakBadge = {
  days: number;
  name: string;
  line: string;        // short flavor text
  shape: BadgeShape;
  colors: [string, string, string?]; // gradient stops
  rays?: boolean;      // light rays behind the badge
  laurel?: boolean;    // leaves around it
  shimmer?: boolean;   // animated rainbow shine
};

export const STREAK_BADGES: StreakBadge[] = [
  { days: 1,   name: "Day One Energy",    line: "You showed up. That's the hardest part.", shape: "circle",  colors: ["#FDE047", "#F97316"] },
  { days: 3,   name: "Hat Trick",         line: "Three in a row. Suspiciously consistent.", shape: "hexagon", colors: ["#6EE7B7", "#059669"] },
  { days: 7,   name: "Week Warrior",      line: "A full week. The squad has noticed.",    shape: "shield",  colors: ["#7DD3FC", "#2563EB"] },
  { days: 10,  name: "Double Digits",     line: "Ten days. Not a fluke anymore.",          shape: "diamond", colors: ["#F9A8D4", "#DB2777"] },
  { days: 14,  name: "Fortnight Fiend",   line: "Two weeks without falling off.",          shape: "octagon", colors: ["#C4B5FD", "#7C3AED"] },
  { days: 21,  name: "Habit Hacker",      line: "21 days. Science says it's a habit now.", shape: "star",    colors: ["#67E8F9", "#0E7490"] },
  { days: 30,  name: "Monthly Menace",    line: "A whole month. Friends are worried.",     shape: "crest",   colors: ["#FDBA74", "#DC2626"] },
  { days: 45,  name: "Unstoppable Force", line: "Six weeks. Nothing stops you.",           shape: "gem",     colors: ["#FB7185", "#9F1239", "#4C0519"] },
  { days: 60,  name: "Two-Month Titan",   line: "Sixty days of pure discipline.",          shape: "flower",  colors: ["#34D399", "#0F766E", "#1E3A8A"] },
  { days: 75,  name: "Diamond Hands",     line: "Holding the streak like a stock.",        shape: "diamond", colors: ["#A5F3FC", "#818CF8", "#4338CA"], rays: true },
  { days: 90,  name: "Quarter Beast",     line: "A full quarter. Absolute unit.",          shape: "burst",   colors: ["#FEF08A", "#F59E0B", "#B45309"], rays: true },
  { days: 100, name: "Centurion",         line: "Triple digits. Legend status.",           shape: "shield",  colors: ["#FDE68A", "#D97706", "#78350F"], rays: true, laurel: true },
  { days: 150, name: "Mythic Grinder",    line: "People tell stories about you.",          shape: "star",    colors: ["#F0ABFC", "#A21CAF", "#3B0764"], rays: true, laurel: true },
  { days: 200, name: "Built Different",   line: "200 days. Not a human, a system.",        shape: "octagon", colors: ["#E2E8F0", "#64748B", "#0F172A"], rays: true, laurel: true },
  { days: 250, name: "Final Boss",        line: "Everyone else is fighting you.",          shape: "gem",     colors: ["#FCA5A5", "#DC2626", "#18181B"], rays: true, laurel: true, shimmer: true },
  { days: 365, name: "The GOAT",          line: "One full year. Frame this.",              shape: "crown",   colors: ["#FDE047", "#F472B6", "#8B5CF6"], rays: true, laurel: true, shimmer: true },
];

export const earnedBadges = (best: number) => STREAK_BADGES.filter((b) => best >= b.days);
export const topBadge = (best: number) => earnedBadges(best).at(-1) ?? null;
export const nextBadge = (current: number) => STREAK_BADGES.find((b) => b.days > current) ?? null;
