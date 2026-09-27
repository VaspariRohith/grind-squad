"use client";

import { Share, X } from "lucide-react";
import { useEffect, useState } from "react";

/** On iPhone Safari (not installed yet), shows how to add the app to the home screen. */
export default function InstallHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone;
    let dismissed = false;
    try { dismissed = localStorage.getItem("install-hint") === "no"; } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(ios && !standalone && !dismissed);
  }, []);
  if (!show) return null;
  return (
    <div className="rise pt-safe -mb-2">
      <div className="card flex items-center gap-3 px-4 py-3 text-sm">
        <Share className="h-5 w-5 shrink-0 text-sky-400" />
        <p className="flex-1 text-soft">
          Install it: tap <b className="text-white">Share</b>, then <b className="text-white">Add to Home Screen</b>.
        </p>
        <button aria-label="Dismiss" onClick={() => { try { localStorage.setItem("install-hint", "no"); } catch {} setShow(false); }}>
          <X className="h-4 w-4 text-mute" />
        </button>
      </div>
    </div>
  );
}
