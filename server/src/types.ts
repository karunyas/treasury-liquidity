/**
 * Shared API contract. Mirrored in web/src/types.ts — keep the two in sync.
 *
 * Money and rates never travel as floats. Yields are integer basis points
 * (4.77% => 477) and cash is integer minor units (US cents), so nothing
 * accumulates representation error on the way through.
 */

export interface TenorPoint {
  key: string;
  label: string;
  months: number;
  yieldBps: number;
  /** Move since the previous published curve, in bps. Null if unavailable. */
  changeDayBps: number | null;
  /** Move since roughly a week earlier, in bps. Null if unavailable. */
  changeWeekBps: number | null;
}

export interface CurveMeta {
  /** Business date the curve describes. */
  asOfDate: string;
  /** When we last pulled it from the source. */
  fetchedAt: string;
  source: string;
  /** True when the curve is older than one business day. */
  stale: boolean;
  /** True when it came from the local store because the source was unreachable. */
  fromStore: boolean;
}

export interface CurveResponse {
  meta: CurveMeta;
  points: TenorPoint[];
  /** Comparison curve for the sparkline — roughly a week back. */
  priorWeek: { asOfDate: string; points: { key: string; yieldBps: number }[] } | null;
  spread2s10s: { bps: number; inverted: boolean } | null;
}

export type OrderSide = "BUY" | "SELL";

/** Derived from the append-only event log; never stored on the order itself. */
export type OrderStatus = "SUBMITTED" | "CANCELLED";

/** A holiday that pushed a booking or settlement date later. */
export interface SkippedHoliday {
  /** ISO date of the closed day. */
  date: string;
  /** Its name, e.g. "Labor Day". */
  name: string;
}

/** One rung of the maturity ladder: cash coming back in a time band. */
export interface MaturityBucket {
  key: string;
  label: string;
  notionalMinor: number;
  orderCount: number;
}

export interface LadderResponse {
  buckets: MaturityBucket[];
  totalMinor: number;
  /** Notional-weighted average months to maturity across open orders. */
  weightedAverageMonths: number;
}

export interface OrderQuote {
  tenorKey: string;
  tenorLabel: string;
  tenorMonths: number;
  amountMinor: number;
  yieldBps: number;
  curveAsOf: string;
  settlementDate: string;
  maturityDate: string;
  /** Income for one year at this yield, in minor units. */
  annualIncomeMinor: number;
  /** Simple non-compounding interest to maturity, in minor units. */
  projectedInterestMinor: number;
  /** Existing open notional at this tenor, in minor units. */
  heldAtTenorMinor: number;
  /** Business date the order books on — today, or the next open one. */
  bookingDate: string;
  /** Why it books then: open, after-cutoff, or market-closed. */
  bookingReason: "open" | "after-cutoff" | "market-closed";
  /** Holidays skipped when rolling to the booking and settlement dates. */
  skippedHolidays: SkippedHoliday[];
  /** Cutoff, as a wall-clock label in the desk's timezone. */
  cutoffLabel: string;
}

export interface QuoteResponse {
  quote: OrderQuote;
  sizing: {
    /** Median past order size, or null with no history to compare against. */
    medianMinor: number | null;
    /** Materially larger than this desk's usual ticket — a warning, not a block. */
    unusuallyLarge: boolean;
  };
}

export interface Order {
  id: string;
  placedAt: string;
  side: OrderSide;
  tenorKey: string;
  tenorLabel: string;
  tenorMonths: number;
  amountMinor: number;
  /** Yield stamped at submission, so history is auditable against later moves. */
  yieldBps: number;
  curveAsOf: string;
  settlementDate: string;
  maturityDate: string;
  projectedInterestMinor: number;
  status: OrderStatus;
  cancelledAt: string | null;
  /**
   * Which maturity-ladder bucket (mirrors MaturityBucket.key) this order's
   * principal falls into, or null. Only open BUY orders get one — a SELL
   * liquidates a position rather than holding one, so it never belongs to
   * a ladder bucket. Computed relative to the request's desk date by
   * attachMaturityBucket(); absent that context (e.g. straight off the
   * insert/cancel path) it is null.
   */
  maturityBucket: string | null;
}

export interface Holding {
  orderId: string;
  tenorKey: string;
  tenorLabel: string;
  side: "BUY" | "SELL";
  notionalMinor: number;
  purchaseYieldBps: number;
  currentYieldBps: number | null;
  purchaseDate: string;
  settlementDate: string;
  maturityDate: string;
  daysHeld: number;
  accruedInterestMinor: number;
  unrealizedPnlMinor: number;
  totalReturnMinor: number;
}

export interface HoldingsResponse {
  holdings: Holding[];
  totalNotionalMinor: number;
  totalAccruedMinor: number;
  totalUnrealizedPnlMinor: number;
  totalReturnMinor: number;
  curveAsOf: string;
}
