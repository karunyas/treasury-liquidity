const MINOR_PER_UNIT = 100;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

export const minorToUnits = (minor: number) => minor / MINOR_PER_UNIT;
export const unitsToMinor = (units: number) => Math.round(units * MINOR_PER_UNIT);

export const formatMinor = (minor: number) => usd.format(minorToUnits(minor));
export const formatMinorCompact = (minor: number) => usdCompact.format(minorToUnits(minor));

/** 477 -> "4.77%" */
export const formatBps = (bps: number) => `${(bps / 100).toFixed(2)}%`;

/** Signed move, e.g. "+5" / "−5" / "0". Unit is added by the caller. */
export function formatBpsDelta(bps: number | null): string {
  if (bps === null) return "—";
  if (bps === 0) return "0";
  return `${bps > 0 ? "+" : "−"}${Math.abs(bps)}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: iso.length === 10 ? "UTC" : undefined,
  });
}

export function formatDateShort(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export const formatClock = (date: Date) =>
  date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });

export const formatTimestamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const formatTimeOnly = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/* ---------------- Amount in words ---------------- */

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES: [number, string][] = [
  [1_000_000_000_000, "trillion"],
  [1_000_000_000, "billion"],
  [1_000_000, "million"],
  [1_000, "thousand"],
];

function underThousand(n: number): string {
  if (n < 20) return ONES[n]!;
  if (n < 100) {
    const rest = n % 10;
    return TENS[Math.floor(n / 10)]! + (rest ? `-${ONES[rest]}` : "");
  }
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` ${underThousand(rest)}` : ""}`;
}

/**
 * Spells out a dollar amount so a mistyped zero is visible at a glance —
 * "$250,000,000" and "$25,000,000" look alike; the words do not.
 */
export function amountToWords(units: number): string {
  if (!Number.isFinite(units) || units < 0) return "";
  const whole = Math.floor(units);
  if (whole === 0) return "zero dollars";

  const parts: string[] = [];
  let remainder = whole;
  for (const [scale, name] of SCALES) {
    if (remainder >= scale) {
      parts.push(`${underThousand(Math.floor(remainder / scale))} ${name}`);
      remainder %= scale;
    }
  }
  if (remainder > 0) parts.push(underThousand(remainder));
  return `${parts.join(" ")} dollar${whole === 1 ? "" : "s"}`;
}
