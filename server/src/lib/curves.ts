import type { CurveResponse, TenorPoint } from "../types.js";
import { businessDaysBetween, bookingWindow } from "./calendar.js";
import {
  curveOnOrBefore,
  latestStoredCurve,
  readCurve,
  storedDates,
  upsertCurvePoints,
} from "./curveStore.js";
import { TENOR_BY_KEY, TENORS } from "./tenors.js";
import { SOURCE_LABEL, fetchYear } from "./treasury.js";

/** Bounds how long a newly published curve can go unnoticed. */
const REFRESH_TTL_MS = 60 * 1000;

let lastRefreshAt = 0;
let lastRefreshFailed = false;

/** Two years covers a week-back comparison across a January boundary. */
function yearsToLoad(): number[] {
  const now = new Date().getUTCFullYear();
  return [now - 1, now];
}

/**
 * Pulls from Treasury into the local store. A failure is not fatal: the store
 * keeps the last good curve, so the screen shows real data with an honest date
 * rather than going blank.
 */
export async function refreshFromSource(force = false): Promise<void> {
  if (!force && Date.now() - lastRefreshAt < REFRESH_TTL_MS) return;

  const fetchedAt = new Date().toISOString();
  try {
    const years = await Promise.all(yearsToLoad().map((year) => fetchYear(year)));
    const rows = years.flat().flatMap((curve) =>
      curve.points.map((point) => ({
        asOfDate: curve.asOfDate,
        tenorKey: point.tenorKey,
        yieldBps: point.yieldBps,
        source: SOURCE_LABEL,
        fetchedAt,
      })),
    );
    if (rows.length > 0) upsertCurvePoints(rows);
    lastRefreshAt = Date.now();
    lastRefreshFailed = false;
  } catch (error) {
    console.warn("[treasury] refresh failed, serving the stored curve:", error);
    lastRefreshFailed = true;
    // Back off so a hard outage doesn't retry on every request.
    lastRefreshAt = Date.now() - REFRESH_TTL_MS / 2;
  }
}

function shiftDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function getCurveResponse(): Promise<CurveResponse> {
  await refreshFromSource();

  const current = latestStoredCurve();
  if (!current) {
    throw Object.assign(
      new Error("No curve data available yet — the Treasury feed could not be reached."),
      { status: 503 },
    );
  }

  const dates = storedDates();
  const previousDate = dates.find((d) => d < current.asOfDate);
  const previous = previousDate ? readCurve(previousDate) : null;
  const priorWeek = curveOnOrBefore(shiftDays(current.asOfDate, 7));

  const byKey = (curve: { points: { tenorKey: string; yieldBps: number }[] } | null) =>
    new Map(curve?.points.map((p) => [p.tenorKey, p.yieldBps]) ?? []);
  const prevMap = byKey(previous);
  const weekMap = byKey(priorWeek && priorWeek.asOfDate !== current.asOfDate ? priorWeek : null);
  const currentMap = byKey(current);

  // Ordered shortest term first, and only tenors the current curve prices.
  const points: TenorPoint[] = TENORS.flatMap((tenor) => {
    const yieldBps = currentMap.get(tenor.key);
    if (yieldBps === undefined) return [];
    const day = prevMap.get(tenor.key);
    const week = weekMap.get(tenor.key);
    return [
      {
        key: tenor.key,
        label: tenor.label,
        months: tenor.months,
        yieldBps,
        changeDayBps: day === undefined ? null : yieldBps - day,
        changeWeekBps: week === undefined ? null : yieldBps - week,
      },
    ];
  });

  const twoYear = currentMap.get("2Y");
  const tenYear = currentMap.get("10Y");
  const spread2s10s =
    twoYear === undefined || tenYear === undefined
      ? null
      : { bps: tenYear - twoYear, inverted: tenYear - twoYear < 0 };

  const deskDate = bookingWindow().deskDate;

  return {
    meta: {
      asOfDate: current.asOfDate,
      fetchedAt: current.fetchedAt,
      source: current.source,
      // One business day behind is normal: today's curve publishes in the
      // afternoon. Two or more means something is wrong.
      stale: businessDaysBetween(current.asOfDate, deskDate) > 1,
      fromStore: lastRefreshFailed,
    },
    points,
    priorWeek:
      priorWeek && priorWeek.asOfDate !== current.asOfDate
        ? {
            asOfDate: priorWeek.asOfDate,
            points: priorWeek.points.map((p) => ({ key: p.tenorKey, yieldBps: p.yieldBps })),
          }
        : null,
    spread2s10s,
  };
}

/** Current published yield for a tenor, used to stamp incoming orders. */
export async function getLiveYieldBps(
  tenorKey: string,
): Promise<{ yieldBps: number; curveAsOf: string }> {
  if (!TENOR_BY_KEY.has(tenorKey)) {
    throw Object.assign(new Error(`Unknown tenor "${tenorKey}"`), { status: 400 });
  }
  await refreshFromSource();

  const current = latestStoredCurve();
  const point = current?.points.find((p) => p.tenorKey === tenorKey);
  if (!current || !point) {
    throw Object.assign(
      new Error(`No published yield for tenor "${tenorKey}" on the latest curve`),
      { status: 422 },
    );
  }
  return { yieldBps: point.yieldBps, curveAsOf: current.asOfDate };
}

/** True when the shown yield no longer matches what the desk would book. */
export function yieldMoved(expectedBps: number, actualBps: number): boolean {
  return expectedBps !== actualBps;
}
