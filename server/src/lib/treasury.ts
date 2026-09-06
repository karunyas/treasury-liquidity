import { XMLParser } from "fast-xml-parser";
import { TENORS } from "./tenors.js";
import { percentToBps } from "./units.js";

const FEED_BASE =
  "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";

export const SOURCE_LABEL = "treasury.gov/daily_treasury_yield_curve";

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: true });

export interface RawCurve {
  asOfDate: string;
  points: { tenorKey: string; yieldBps: number }[];
}

export function feedUrlForYear(year: number): string {
  return `${FEED_BASE}?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
}

/**
 * Turns one year of Treasury's Atom/OData feed into curves, oldest first.
 * Pure and network-free, so it can be tested against a fixture.
 */
export function parseYieldCurveXml(xml: string): RawCurve[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const entries = toArray(doc?.feed?.entry);

  const curves: RawCurve[] = [];
  for (const entry of entries) {
    const props = entry?.content?.["m:properties"] ?? entry?.["m:properties"];
    if (!props) continue;

    const rawDate = props["d:NEW_DATE"];
    if (rawDate === undefined || rawDate === null) continue;
    const asOfDate = String(rawDate).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) continue;

    const points: RawCurve["points"] = [];
    for (const tenor of TENORS) {
      const value = props[`d:${tenor.field}`];
      // Tenors absent from older records, or published blank on a given day,
      // are omitted rather than recorded as zero.
      if (value === undefined || value === null || value === "") continue;
      const percent = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(percent)) continue;
      points.push({ tenorKey: tenor.key, yieldBps: percentToBps(percent) });
    }
    if (points.length === 0) continue;

    curves.push({ asOfDate, points });
  }

  curves.sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
  return curves;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export async function fetchYear(year: number): Promise<RawCurve[]> {
  const response = await fetch(feedUrlForYear(year), {
    headers: { Accept: "application/atom+xml" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Treasury feed returned ${response.status} for ${year}`);
  }
  return parseYieldCurveXml(await response.text());
}
