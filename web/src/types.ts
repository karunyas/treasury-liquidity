/**
 * Mirrors server/src/types.ts — the two are kept in sync by hand.
 * Yields are integer basis points; cash is integer minor units (cents).
 */

export interface TenorPoint {
  key: string;
  label: string;
  months: number;
  yieldBps: number;
  changeDayBps: number | null;
  changeWeekBps: number | null;
}

export interface CurveMeta {
  asOfDate: string;
  fetchedAt: string;
  source: string;
  stale: boolean;
  fromStore: boolean;
}

export interface CurveResponse {
  meta: CurveMeta;
  points: TenorPoint[];
  priorWeek: { asOfDate: string; points: { key: string; yieldBps: number }[] } | null;
  spread2s10s: { bps: number; inverted: boolean } | null;
}

export type OrderSide = "BUY" | "SELL";
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
  annualIncomeMinor: number;
  projectedInterestMinor: number;
  heldAtTenorMinor: number;
  bookingDate: string;
  bookingReason: "open" | "after-cutoff" | "market-closed";
  /** Holidays skipped when rolling to the booking and settlement dates. */
  skippedHolidays: SkippedHoliday[];
  cutoffLabel: string;
}

export interface QuoteSizing {
  medianMinor: number | null;
  unusuallyLarge: boolean;
}

export interface QuoteResponse {
  quote: OrderQuote;
  sizing: QuoteSizing;
}

export interface Order {
  id: string;
  placedAt: string;
  side: OrderSide;
  tenorKey: string;
  tenorLabel: string;
  tenorMonths: number;
  amountMinor: number;
  yieldBps: number;
  curveAsOf: string;
  settlementDate: string;
  maturityDate: string;
  projectedInterestMinor: number;
  status: OrderStatus;
  cancelledAt: string | null;
  /** Maturity-ladder bucket key (mirrors MaturityBucket.key), or null for
   *  SELL/cancelled orders — server-computed, see attachMaturityBucket(). */
  maturityBucket: string | null;
  /** Set locally on optimistic rows until the server confirms. */
  pending?: boolean;
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
