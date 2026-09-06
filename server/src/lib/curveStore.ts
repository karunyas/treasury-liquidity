import { db } from "./database.js";

export interface StoredPoint {
  tenorKey: string;
  yieldBps: number;
}

export interface StoredCurve {
  asOfDate: string;
  fetchedAt: string;
  source: string;
  points: StoredPoint[];
}

/**
 * DO UPDATE, not DO NOTHING.
 *
 * Treasury restates published curves from time to time. Ignoring a conflict
 * would silently keep the superseded number forever, so a re-fetch overwrites
 * the yield and records when we saw it.
 */
const upsertStmt = db.prepare(`
  INSERT INTO curve_points (as_of_date, tenor_key, yield_bps, source, fetched_at)
  VALUES (@asOfDate, @tenorKey, @yieldBps, @source, @fetchedAt)
  ON CONFLICT (as_of_date, tenor_key) DO UPDATE SET
    yield_bps  = excluded.yield_bps,
    source     = excluded.source,
    fetched_at = excluded.fetched_at
`);

export const upsertCurvePoints = db.transaction(
  (rows: { asOfDate: string; tenorKey: string; yieldBps: number; source: string; fetchedAt: string }[]) => {
    for (const row of rows) upsertStmt.run(row);
    return rows.length;
  },
);

const datesStmt = db.prepare(
  `SELECT DISTINCT as_of_date AS d FROM curve_points ORDER BY as_of_date DESC LIMIT ?`,
);

const curveStmt = db.prepare(`
  SELECT tenor_key AS tenorKey, yield_bps AS yieldBps, source, fetched_at AS fetchedAt
  FROM curve_points WHERE as_of_date = ?
`);

/** Most recent stored business dates, newest first. */
export function storedDates(limit = 400): string[] {
  return (datesStmt.all(limit) as { d: string }[]).map((r) => r.d);
}

export function readCurve(asOfDate: string): StoredCurve | null {
  const rows = curveStmt.all(asOfDate) as {
    tenorKey: string;
    yieldBps: number;
    source: string;
    fetchedAt: string;
  }[];
  if (rows.length === 0) return null;
  return {
    asOfDate,
    // The newest fetch across the row set is when we last confirmed this curve.
    fetchedAt: rows.reduce((max, r) => (r.fetchedAt > max ? r.fetchedAt : max), rows[0]!.fetchedAt),
    source: rows[0]!.source,
    points: rows.map(({ tenorKey, yieldBps }) => ({ tenorKey, yieldBps })),
  };
}

/** Latest stored curve, or null when the store has never been populated. */
export function latestStoredCurve(): StoredCurve | null {
  const [latest] = storedDates(1);
  return latest ? readCurve(latest) : null;
}

/** Latest stored curve dated on or before `target`. */
export function curveOnOrBefore(target: string): StoredCurve | null {
  const match = storedDates().find((d) => d <= target);
  return match ? readCurve(match) : null;
}
