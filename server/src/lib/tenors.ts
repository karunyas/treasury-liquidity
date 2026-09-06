export interface TenorDef {
  key: string;
  label: string;
  months: number;
  /** Field name in Treasury's XML feed. */
  field: string;
}

/**
 * The par yield curve tenors published by Treasury, shortest first.
 *
 * Note: 1.5-month and 4-month bills were added to the series relatively
 * recently, so older records simply omit those fields. The parser drops
 * missing tenors rather than assuming the full set is always present.
 */
export const TENORS: TenorDef[] = [
  { key: "1M", label: "1 Mo", months: 1, field: "BC_1MONTH" },
  { key: "1.5M", label: "1.5 Mo", months: 1.5, field: "BC_1_5MONTH" },
  { key: "2M", label: "2 Mo", months: 2, field: "BC_2MONTH" },
  { key: "3M", label: "3 Mo", months: 3, field: "BC_3MONTH" },
  { key: "4M", label: "4 Mo", months: 4, field: "BC_4MONTH" },
  { key: "6M", label: "6 Mo", months: 6, field: "BC_6MONTH" },
  { key: "1Y", label: "1 Yr", months: 12, field: "BC_1YEAR" },
  { key: "2Y", label: "2 Yr", months: 24, field: "BC_2YEAR" },
  { key: "3Y", label: "3 Yr", months: 36, field: "BC_3YEAR" },
  { key: "5Y", label: "5 Yr", months: 60, field: "BC_5YEAR" },
  { key: "7Y", label: "7 Yr", months: 84, field: "BC_7YEAR" },
  { key: "10Y", label: "10 Yr", months: 120, field: "BC_10YEAR" },
  { key: "20Y", label: "20 Yr", months: 240, field: "BC_20YEAR" },
  { key: "30Y", label: "30 Yr", months: 360, field: "BC_30YEAR" },
];

export const TENOR_BY_KEY = new Map(TENORS.map((t) => [t.key, t]));

/** Adds a whole/fractional number of months to a date, clamping to month end. */
export function addMonths(from: Date, months: number): Date {
  const whole = Math.floor(months);
  const out = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const targetDay = out.getUTCDate();
  out.setUTCMonth(out.getUTCMonth() + whole);
  // setUTCMonth rolls over when the target month is shorter (Jan 31 -> Mar 3).
  if (out.getUTCDate() !== targetDay) out.setUTCDate(0);
  const fractionDays = Math.round((months - whole) * 30);
  if (fractionDays) out.setUTCDate(out.getUTCDate() + fractionDays);
  return out;
}
