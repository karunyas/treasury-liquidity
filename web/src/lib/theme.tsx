import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";

// ── Public types ─────────────────────────────────────────────────────────

export type ThemeMode = "system" | "light" | "dark";

export interface ThemeState {
  mode: ThemeMode;
  colorblind: boolean;
  /** Resolved effective appearance (never "system"). */
  resolved: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
  setColorblind: (on: boolean) => void;
}

// ── Chart palette ────────────────────────────────────────────────────────

/**
 * Chart colours have to reach Recharts as literal values (CSS custom
 * properties don't resolve inside SVG presentation attributes), so the
 * palette lives here as hex and the CSS mirrors it for everything else.
 */
export interface ChartPalette {
  series1: string;
  series2: string;
  deltaUp: string;
  deltaDown: string;
  grid: string;
  axis: string;
  muted: string;
  text: string;
  surface: string;
}

const LIGHT: ChartPalette = {
  series1: "#2a78d6",
  series2: "#eb6834",
  deltaUp: "#0f7a2e",
  deltaDown: "#b3261e",
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  muted: "#898781",
  text: "#0b0b0b",
  surface: "#fcfcfb",
};

const DARK: ChartPalette = {
  series1: "#3987e5",
  series2: "#d95926",
  deltaUp: "#3ec46a",
  deltaDown: "#e66767",
  grid: "#2c2c2a",
  axis: "#383835",
  muted: "#898781",
  text: "#ffffff",
  surface: "#1a1a19",
};

/* Colorblind-safe: blue/orange series preserved (already good contrast);
   deltas swap red/green for blue/orange. Both pairs ΔE > 30. */
const LIGHT_CB: ChartPalette = {
  ...LIGHT,
  series1: "#0b57d0",
  series2: "#c26a1a",
  deltaUp: "#1a73e8",
  deltaDown: "#e8710a",
};

const DARK_CB: ChartPalette = {
  ...DARK,
  series1: "#5e9eef",
  series2: "#f09d51",
  deltaUp: "#5e9eef",
  deltaDown: "#f09d51",
};

// ── Persistence ──────────────────────────────────────────────────────────

const MODE_KEY = "theme-mode";
const CB_KEY = "theme-colorblind";

function loadMode(): ThemeMode {
  const stored = localStorage.getItem(MODE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  return "system";
}

function loadColorblind(): boolean {
  return localStorage.getItem(CB_KEY) === "true";
}

// ── Context ──────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeState | null>(null);

function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode !== "system") return mode;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeRaw] = useState<ThemeMode>(loadMode);
  const [colorblind, setCbRaw] = useState(loadColorblind);
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolveMode(mode));

  const setMode = useCallback((m: ThemeMode) => {
    localStorage.setItem(MODE_KEY, m);
    setModeRaw(m);
  }, []);

  const setColorblind = useCallback((on: boolean) => {
    localStorage.setItem(CB_KEY, String(on));
    setCbRaw(on);
  }, []);

  // Re-resolve when mode changes or OS preference changes.
  useEffect(() => {
    setResolved(resolveMode(mode));
    if (mode !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(resolveMode("system"));
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);

  // Apply data attributes to <html> for CSS selectors.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", mode === "system" ? "" : mode);
    if (colorblind) {
      root.setAttribute("data-colorblind", "");
    } else {
      root.removeAttribute("data-colorblind");
    }
  }, [mode, colorblind, resolved]);

  return (
    <ThemeContext.Provider value={{ mode, colorblind, resolved, setMode, setColorblind }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}

export function useChartPalette(): ChartPalette {
  const { resolved, colorblind } = useTheme();
  if (colorblind) return resolved === "dark" ? DARK_CB : LIGHT_CB;
  return resolved === "dark" ? DARK : LIGHT;
}
