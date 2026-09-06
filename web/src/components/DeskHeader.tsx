import { useRef, useState, useEffect } from "react";
import type { CurveMeta } from "../types";
import type { ThemeMode } from "../lib/theme";
import { useTheme } from "../lib/theme";
import { formatBpsDelta, formatClock, formatDate, formatTimeOnly } from "../lib/format";

interface Props {
  meta: CurveMeta;
  spread: { bps: number; inverted: boolean } | null;
  cutoffLabel: string | null;
  lastCheckedAt: Date | null;
  navigate: (hash: string) => void;
  route: string;
}

/**
 * The as-of date is always on screen, not only when something goes wrong.
 * It turns amber once the curve is more than one business day behind, which
 * is the point at which the numbers below stop describing the current market.
 */
export function DeskHeader({ meta, spread, cutoffLabel, lastCheckedAt, navigate, route }: Props) {
  return (
    <header className="masthead">
      <div>
        <h1>Treasury Liquidity Desk</h1>
        <p className="masthead-sub">
          {spread ? (
            <>
              {/* Desk shorthand is right for the audience, but the number is
                  useless if you have to already know it. The clause after it
                  says what the shape means for someone placing cash. */}
              <span title="2s10s: the 10-year yield minus the 2-year yield — the standard measure of curve shape.">
                2s10s{" "}
                <strong className={spread.inverted ? "text-critical" : undefined}>
                  {formatBpsDelta(spread.bps)} bps
                </strong>
              </span>
              {spread.inverted ? (
                <span className="text-critical"> · inverted — short terms pay more than long</span>
              ) : (
                <> · longer terms pay more</>
              )}
            </>
          ) : (
            "2s10s spread unavailable"
          )}
          {cutoffLabel && <> · orders after {cutoffLabel} settle a day later</>}
        </p>
      </div>

      <div className="masthead-right">
        <AppearanceMenu />
        <NavButtons navigate={navigate} route={route} />
        <div className={meta.stale ? "asof asof-stale" : "asof"}>
          <div className="asof-primary">
            {meta.stale && <span aria-hidden="true">▲ </span>}
            Curve as of {formatDate(meta.asOfDate)}
          </div>
          <div className="asof-secondary">
            {meta.stale && <strong>More than one business day old. </strong>}
            Checked {lastCheckedAt ? formatClock(lastCheckedAt) : "…"}
            {meta.fromStore && (
              <> · source unreachable, last retrieved {formatTimeOnly(meta.fetchedAt)}</>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

function AppearanceMenu() {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="appearance-anchor" ref={menuRef}>
      <button
        type="button"
        className="appearance-btn"
        title="Appearance settings"
        aria-label="Appearance settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {/* Half-sun / half-moon icon – simple, no external deps */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4 A4 4 0 0 1 8 12 Z" fill="currentColor" />
          <line x1="8" y1="0.5" x2="8" y2="2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="8" y1="13.5" x2="8" y2="15.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="0.5" y1="8" x2="2.5" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <line x1="13.5" y1="8" x2="15.5" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="appearance-popover" role="dialog" aria-label="Appearance settings">
          <label className="appearance-row">
            <span className="appearance-label">Theme</span>
            <select
              className="theme-select"
              value={theme.mode}
              onChange={(e) => theme.setMode(e.target.value as ThemeMode)}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label className="appearance-row">
            <span className="appearance-label">Colorblind-friendly</span>
            <input
              type="checkbox"
              checked={theme.colorblind}
              onChange={(e) => theme.setColorblind(e.target.checked)}
            />
          </label>
        </div>
      )}
    </div>
  );
}

function NavButtons({ navigate, route }: { navigate: (hash: string) => void; route: string }) {
  // On the main desk view, show scroll shortcuts to sections on the page
  const isMainDesk = !route.startsWith("#/orders") && !route.startsWith("#/portfolio");

  if (isMainDesk) {
    return (
      <div className="nav-buttons">
        <button
          type="button"
          className="nav-btn"
          onClick={() => {
            document.querySelector("#todays-orders")?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          Today's Orders
        </button>
        <button
          type="button"
          className="nav-btn"
          onClick={() => {
            document.querySelector("#portfolio")?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          Portfolio
        </button>
      </div>
    );
  }

  // On multi-page views, show route navigation buttons
  return (
    <div className="nav-buttons">
      <button
        type="button"
        className="nav-btn"
        onClick={() => navigate("#/orders")}
      >
        All Orders
      </button>
      <button
        type="button"
        className="nav-btn"
        onClick={() => navigate("#/portfolio")}
      >
        Portfolio
      </button>
    </div>
  );
}
