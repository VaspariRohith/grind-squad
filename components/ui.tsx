"use client";

import { X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/* ---------------- Avatar ---------------- */
const AVATAR_GRADIENTS = [
  ["#FF5FA2", "#FF9A6B"], ["#6366F1", "#22D3EE"], ["#1FD17A", "#B6F03C"], ["#8B5CF6", "#F472B6"],
  ["#F97316", "#FACC15"], ["#06B6D4", "#3B82F6"], ["#EF4444", "#F59E0B"], ["#14B8A6", "#A3E635"],
];
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function Avatar({ name, url, size = 44, ring }: { name: string; url?: string | null; size?: number; ring?: string }) {
  const [a, b] = AVATAR_GRADIENTS[hash(name) % AVATAR_GRADIENTS.length];
  const style: React.CSSProperties = {
    width: size, height: size,
    boxShadow: ring ? `0 0 0 3px var(--color-bg), 0 0 0 5px ${ring}` : undefined,
  };
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} style={style} className="shrink-0 rounded-full object-cover" />;
  }
  return (
    <div style={{ ...style, background: `linear-gradient(135deg, ${a}, ${b})`, fontSize: size * 0.42 }}
      className="grid shrink-0 place-items-center rounded-full font-extrabold text-white">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </div>
  );
}

/* ---------------- Toggle (iOS-style switch) ---------------- */
export function Toggle({ on, onChange, from = "#ff4d8d", to = "#ff9a3d", disabled }: {
  on: boolean; onChange: (v: boolean) => void; from?: string; to?: string; disabled?: boolean;
}) {
  return (
    <button
      type="button" role="switch" aria-checked={on} disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative h-8 w-[52px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40"
      style={{ background: on ? `linear-gradient(135deg, ${from}, ${to})` : "rgba(255,255,255,0.12)" }}
    >
      <span
        className="absolute top-1 left-1 h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-200"
        style={{ transform: on ? "translateX(20px)" : "translateX(0)" }}
      />
    </button>
  );
}

/* ---------------- Segmented control ---------------- */
export function Segmented<T extends string>({ value, options, onChange, size = "md" }: {
  value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; size?: "sm" | "md";
}) {
  return (
    <div className="flex gap-1 rounded-2xl bg-white/[0.06] p-1">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`flex-1 rounded-xl font-bold transition-all ${size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm"} ${
            value === o.value ? "bg-white text-black shadow" : "text-mute"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Bottom sheet ---------------- */
export function Sheet({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);
  if (!open || typeof document === "undefined") return null; // sheets only open after a tap
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="fade-in absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="sheet-in pb-safe relative max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-[2rem] border-t border-line bg-[#15151f] px-5 pt-3">
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/20" />
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-xl font-extrabold">{title}</h3>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-white/10" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="pb-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- Toast ---------------- */
type ToastMsg = { id: number; text: string; kind: "ok" | "err" };
let push: ((t: Omit<ToastMsg, "id">) => void) | null = null;
export const toast = {
  ok: (text: string) => push?.({ text, kind: "ok" }),
  err: (text: string) => push?.({ text, kind: "err" }),
};
export function Toaster() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  useEffect(() => {
    push = (t) => {
      const id = Date.now() + Math.random();
      setItems((s) => [...s, { ...t, id }]);
      setTimeout(() => setItems((s) => s.filter((x) => x.id !== id)), 3200);
    };
    return () => { push = null; };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4 pt-safe">
      {items.map((t) => (
        <div key={t.id} className={`rise pointer-events-auto max-w-sm rounded-2xl px-4 py-3 text-sm font-semibold shadow-2xl ${
          t.kind === "ok" ? "bg-white text-black" : "bg-rose-500 text-white"}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ---------------- Misc ---------------- */
export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return <div className={`${className} animate-spin rounded-full border-[3px] border-white/15 border-t-brand`} />;
}

export function PageHeader({ title, sub, right }: { title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <header className="pt-safe mb-5 flex items-end justify-between gap-3">
      <div>
        <h1 className="text-[2rem] leading-tight font-black tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-mute">{sub}</p>}
      </div>
      {right}
    </header>
  );
}

export function Empty({ icon, title, sub }: { icon: ReactNode; title: string; sub?: string }) {
  return (
    <div className="card flex flex-col items-center px-6 py-10 text-center">
      <div className="mb-3 text-4xl">{icon}</div>
      <p className="font-bold">{title}</p>
      {sub && <p className="mt-1 text-sm text-mute">{sub}</p>}
    </div>
  );
}
