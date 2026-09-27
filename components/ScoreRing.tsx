export default function ScoreRing({ value, max, size = 132 }: { value: number; max: number; size?: number }) {
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  const negative = value < 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ff4d8d" />
            <stop offset="0.5" stopColor="#ff9a3d" />
            <stop offset="1" stopColor="#facc15" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ring)" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset .6s cubic-bezier(.2,.9,.3,1)", filter: "drop-shadow(0 0 8px rgba(255,77,141,.5))" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div key={value} className={`animate-pop text-4xl font-black tabular-nums ${negative ? "text-rose-400" : ""}`}>{value}</div>
          <div className="text-xs font-bold text-mute">of {max} pts</div>
        </div>
      </div>
    </div>
  );
}
