/**
 * Integer money and rates.
 *
 * Yields are basis points; cash is minor units (cents). Conversions happen
 * only at the edges — parsing the feed, and formatting for display.
 */

export const BPS_PER_PERCENT = 100;
export const MINOR_PER_UNIT = 100;

/** "4.77" (percent, from the feed) -> 477 bps. */
export function percentToBps(percent: number): number {
  return Math.round(percent * BPS_PER_PERCENT);
}

/** Whole dollars -> minor units. */
export function unitsToMinor(units: number): number {
  return Math.round(units * MINOR_PER_UNIT);
}

/**
 * Interest over `months` at `yieldBps`, in minor units.
 *
 * Kept in integers throughout: the numerator is a product of integers and the
 * single division is rounded once, so there is no float drift to accumulate.
 */
export function simpleInterestMinor(
  principalMinor: number,
  yieldBps: number,
  months: number,
): number {
  // principal * (bps / 10_000) * (months / 12)
  return Math.round((principalMinor * yieldBps * months) / (10_000 * 12));
}
