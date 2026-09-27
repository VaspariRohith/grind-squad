import {
  Activity, AlarmClock, Apple, Bed, Beef, Book, BookOpen, ChefHat, Cigarette, Droplets, Dumbbell,
  Flame, Footprints, Leaf, Moon, MoonStar, PersonStanding, Pill, Pizza, Salad, Skull, Sparkles,
  Sun, SunMedium, Timer, Wine, Star, type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  sparkles: Sparkles, dumbbell: Dumbbell, apple: Apple, book: Book, moon: Moon, skull: Skull,
  sun: Sun, "moon-star": MoonStar, "sun-medium": SunMedium, footprints: Footprints, flame: Flame,
  activity: Activity, stretch: PersonStanding, beef: Beef, droplets: Droplets, salad: Salad,
  "chef-hat": ChefHat, pill: Pill, timer: Timer, "book-open": BookOpen, bed: Bed,
  "alarm-clock": AlarmClock, pizza: Pizza, wine: Wine, cigarette: Cigarette, leaf: Leaf,
};

export default function Icon({ name, className, strokeWidth = 2.2 }: { name: string; className?: string; strokeWidth?: number }) {
  const C = MAP[name] ?? Star;
  return <C className={className} strokeWidth={strokeWidth} />;
}

/** Rounded square tile with the category gradient behind an icon. */
export function IconTile({ name, from, to, size = 44, className = "" }: { name: string; from: string; to: string; size?: number; className?: string }) {
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-2xl text-white ${className}`}
      style={{
        width: size, height: size,
        background: `linear-gradient(135deg, ${from}, ${to})`,
        boxShadow: `0 8px 20px -8px ${to}`,
      }}
    >
      <Icon name={name} className="h-[55%] w-[55%]" />
    </div>
  );
}
