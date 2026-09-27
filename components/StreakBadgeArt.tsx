import type { BadgeShape, StreakBadge } from "@/lib/badges";

// Star-like polygon helper (all shapes live in a 100x100 box)
function starPoints(points: number, outer: number, inner: number, rot = -90) {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = ((rot + (i * 180) / points) * Math.PI) / 180;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}
function polygon(n: number, r: number, rot = -90) {
  return Array.from({ length: n }, (_, i) => {
    const a = ((rot + (i * 360) / n) * Math.PI) / 180;
    return `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
}

function Shape({ shape, fill, stroke }: { shape: BadgeShape; fill: string; stroke?: string }) {
  const p = { fill, stroke, strokeWidth: stroke ? 2.5 : 0, strokeLinejoin: "round" as const };
  switch (shape) {
    case "circle": return <circle cx="50" cy="50" r="40" {...p} />;
    case "hexagon": return <polygon points={polygon(6, 43)} {...p} />;
    case "octagon": return <polygon points={polygon(8, 43, -67.5)} {...p} />;
    case "diamond": return <polygon points="50,5 92,50 50,95 8,50" {...p} />;
    case "star": return <polygon points={starPoints(5, 47, 30)} {...p} />;
    case "burst": return <polygon points={starPoints(12, 46, 37)} {...p} />;
    case "flower": return <polygon points={starPoints(8, 45, 36, -90)} {...p} />;
    case "shield": return <path d="M50 5 L87 17 V47 C87 71 70 86 50 95 C30 86 13 71 13 47 V17 Z" {...p} />;
    case "crest": return <path d="M50 5 C72 5 92 16 92 40 C92 68 72 87 50 95 C28 87 8 68 8 40 C8 16 28 5 50 5 Z" {...p} />;
    case "gem": return <polygon points="30,8 70,8 94,36 50,95 6,36" {...p} />;
    case "crown": return <circle cx="50" cy="54" r="38" {...p} />;
  }
}

export default function StreakBadgeArt({
  badge, locked = false, size = 88,
}: { badge: StreakBadge; locked?: boolean; size?: number }) {
  const id = `b${badge.days}`;
  const [c1, c2, c3] = badge.colors;
  const textY = badge.shape === "gem" ? 50 : badge.shape === "crown" ? 62 : 56;
  const numSize = badge.days >= 100 ? 24 : 28;
  return (
    <svg viewBox="-8 -8 116 116" width={size} height={size}
      className={locked ? "opacity-35 grayscale" : ""} aria-label={badge.name}>
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c1}>
            {badge.shimmer && !locked && <animate attributeName="stop-color" values={`${c1};${c2};${c3 ?? c1};${c1}`} dur="5s" repeatCount="indefinite" />}
          </stop>
          <stop offset={c3 ? "0.55" : "1"} stopColor={c2}>
            {badge.shimmer && !locked && <animate attributeName="stop-color" values={`${c2};${c3 ?? c1};${c1};${c2}`} dur="5s" repeatCount="indefinite" />}
          </stop>
          {c3 && (
            <stop offset="1" stopColor={c3}>
              {badge.shimmer && !locked && <animate attributeName="stop-color" values={`${c3};${c1};${c2};${c3}`} dur="5s" repeatCount="indefinite" />}
            </stop>
          )}
        </linearGradient>
        <radialGradient id={`${id}r`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={c1} stopOpacity="0.65" />
          <stop offset="1" stopColor={c1} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {badge.rays && !locked && (
        <g className="badge-rays" style={{ transformOrigin: "50px 50px" }}>
          <circle cx="50" cy="50" r="56" fill={`url(#${id}r)`} />
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} x="48.5" y="-6" width="3" height="16" rx="1.5" fill={c1} opacity="0.55"
              transform={`rotate(${i * 30} 50 50)`} />
          ))}
        </g>
      )}

      {badge.laurel && (
        <g fill="none" stroke={locked ? "#555" : "#FACC15"} strokeWidth="3" strokeLinecap="round">
          {[-1, 1].map((side) => (
            <g key={side} transform={side === 1 ? "translate(100 0) scale(-1 1)" : undefined}>
              <path d="M22 88 C6 74 2 50 10 28" />
              {[0, 1, 2, 3, 4].map((i) => (
                <ellipse key={i} cx={6 + i * 1.2} cy={80 - i * 12} rx="5" ry="2.6" fill={locked ? "#555" : "#FACC15"}
                  stroke="none" transform={`rotate(${-50 + i * 8} ${6 + i * 1.2} ${80 - i * 12})`} />
              ))}
            </g>
          ))}
        </g>
      )}

      <Shape shape={badge.shape} fill={`url(#${id}g)`} stroke="rgba(255,255,255,0.35)" />
      {/* inner ring */}
      <g transform="translate(50 50) scale(0.8) translate(-50 -50)">
        <Shape shape={badge.shape} fill="none" stroke="rgba(255,255,255,0.28)" />
      </g>
      {/* glossy highlight */}
      <ellipse cx="50" cy="30" rx="26" ry="12" fill={`url(#${id}s)`} />

      {badge.shape === "crown" && (
        <path d="M28 30 L34 10 L44 22 L50 4 L56 22 L66 10 L72 30 Z" fill="#FDE047" stroke="#B45309" strokeWidth="2" strokeLinejoin="round" />
      )}

      <text x="50" y={textY} textAnchor="middle" fontSize={numSize} fontWeight="900"
        fill="#fff" style={{ paintOrder: "stroke" }} stroke="rgba(0,0,0,0.25)" strokeWidth="3" fontFamily="inherit">
        {badge.days}
      </text>
      <text x="50" y={textY + 13} textAnchor="middle" fontSize="8.5" fontWeight="800" letterSpacing="1.5"
        fill="rgba(255,255,255,0.9)" fontFamily="inherit">
        {badge.days === 1 ? "DAY" : "DAYS"}
      </text>
    </svg>
  );
}
