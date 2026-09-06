import { db } from "./database.js";
import type { Order, OrderSide, OrderStatus, MaturityBucket, LadderResponse } from "../types.js";

interface OrderRow {
  id: string;
  placed_at: string;
  side: OrderSide;
  tenor_key: string;
  tenor_label: string;
  tenor_months: number;
  amount_minor: number;
  yield_bps: number;
  curve_as_of: string;
  settlement_date: string;
  maturity_date: string;
  projected_interest_minor: number;
  status: OrderStatus;
  cancelled_at: string | null;
}

/**
 * Current status is derived from the newest event, never stored on the order.
 * The order row itself is written once and never updated.
 */
const SELECT_ORDERS = `
  SELECT o.*,
         (SELECT e.event FROM order_events e
           WHERE e.order_id = o.id ORDER BY e.seq DESC LIMIT 1) AS status,
         (SELECT e.occurred_at FROM order_events e
           WHERE e.order_id = o.id AND e.event = 'CANCELLED'
           ORDER BY e.seq DESC LIMIT 1) AS cancelled_at
  FROM orders o
`;

function toOrder(row: OrderRow): Order {
  return {
    id: row.id,
    placedAt: row.placed_at,
    side: row.side,
    tenorKey: row.tenor_key,
    tenorLabel: row.tenor_label,
    tenorMonths: row.tenor_months,
    amountMinor: row.amount_minor,
    yieldBps: row.yield_bps,
    curveAsOf: row.curve_as_of,
    settlementDate: row.settlement_date,
    maturityDate: row.maturity_date,
    projectedInterestMinor: row.projected_interest_minor,
    status: row.status,
    cancelledAt: row.cancelled_at,
    // Only meaningful relative to a request's desk date — see
    // attachMaturityBucket(). Callers without that context get null.
    maturityBucket: null,
  };
}

const insertOrderStmt = db.prepare(`
  INSERT INTO orders (
    id, idempotency_key, placed_at, side, tenor_key, tenor_label, tenor_months,
    amount_minor, yield_bps, curve_as_of, settlement_date, maturity_date,
    projected_interest_minor
  ) VALUES (
    @id, @idempotencyKey, @placedAt, @side, @tenorKey, @tenorLabel, @tenorMonths,
    @amountMinor, @yieldBps, @curveAsOf, @settlementDate, @maturityDate,
    @projectedInterestMinor
  )
`);

const insertEventStmt = db.prepare(
  `INSERT INTO order_events (order_id, event, occurred_at) VALUES (?, ?, ?)`,
);

const byIdStmt = db.prepare(`${SELECT_ORDERS} WHERE o.id = ?`);
const byKeyStmt = db.prepare(`${SELECT_ORDERS} WHERE o.idempotency_key = ?`);
const listStmt = db.prepare(`${SELECT_ORDERS} ORDER BY o.placed_at DESC, o.rowid DESC LIMIT ?`);
const sinceStmt = db.prepare(
  `${SELECT_ORDERS} WHERE o.placed_at >= ? ORDER BY o.placed_at DESC, o.rowid DESC`,
);

const heldStmt = db.prepare(`
  SELECT COALESCE(SUM(CASE WHEN o.side = 'BUY' THEN o.amount_minor ELSE -o.amount_minor END), 0) AS held
  FROM orders o
  WHERE o.tenor_key = ?
    AND (SELECT e.event FROM order_events e
          WHERE e.order_id = o.id ORDER BY e.seq DESC LIMIT 1) = 'SUBMITTED'
`);

const amountsStmt = db.prepare(`SELECT amount_minor AS amount FROM orders`);

export function getOrder(id: string): Order | null {
  const row = byIdStmt.get(id) as OrderRow | undefined;
  return row ? toOrder(row) : null;
}

export function getOrderByIdempotencyKey(key: string): Order | null {
  const row = byKeyStmt.get(key) as OrderRow | undefined;
  return row ? toOrder(row) : null;
}

export function listOrders(limit = 500): Order[] {
  return (listStmt.all(limit) as OrderRow[]).map(toOrder);
}

/** Orders placed at or after an ISO instant — used for "today's orders". */
export function listOrdersSince(isoInstant: string): Order[] {
  return (sinceStmt.all(isoInstant) as OrderRow[]).map(toOrder);
}

/** Open notional at a tenor, in minor units. Cancelled orders don't count. */
export function heldAtTenorMinor(tenorKey: string): number {
  return (heldStmt.get(tenorKey) as { held: number }).held;
}

/** Median past order size in minor units, for flagging unusually large tickets. */
export function medianOrderMinor(): number | null {
  const amounts = (amountsStmt.all() as { amount: number }[])
    .map((r) => r.amount)
    .sort((a, b) => a - b);
  if (amounts.length === 0) return null;
  const mid = Math.floor(amounts.length / 2);
  return amounts.length % 2 === 1
    ? amounts[mid]!
    : Math.round((amounts[mid - 1]! + amounts[mid]!) / 2);
}

export interface NewOrder extends Omit<Order, "status" | "cancelledAt" | "maturityBucket"> {
  idempotencyKey: string;
}

/**
 * Writes the order and its opening event atomically. The unique constraint on
 * idempotency_key is what makes a retried submission safe: the caller checks
 * for an existing order first, and this is the backstop if two arrive at once.
 */
export const insertOrder = db.transaction((order: NewOrder): Order => {
  insertOrderStmt.run(order);
  insertEventStmt.run(order.id, "SUBMITTED", order.placedAt);
  return getOrder(order.id)!;
});

/**
 * Whether an order is still eligible to be cancelled: open, and not yet
 * settled. Once settlement passes the trade is done — real Treasury
 * purchases work the same way, cancellable only before the auction closes
 * or before the transaction processes; after that, only a new (offsetting)
 * trade undoes it.
 */
export function isCancellable(order: Pick<Order, "status" | "settlementDate">, todayIso: string): boolean {
  return order.status === "SUBMITTED" && order.settlementDate > todayIso;
}

/** Appends a CANCELLED event. Returns null if the order isn't currently open. */
export const cancelOrder = db.transaction((id: string, occurredAt: string): Order | null => {
  const existing = getOrder(id);
  if (!existing || existing.status !== "SUBMITTED") return null;
  insertEventStmt.run(id, "CANCELLED", occurredAt);
  return getOrder(id)!;
});

export function orderEvents(id: string): { event: string; occurredAt: string }[] {
  return db
    .prepare(
      `SELECT event, occurred_at AS occurredAt FROM order_events WHERE order_id = ? ORDER BY seq`,
    )
    .all(id) as { event: string; occurredAt: string }[];
}

/** The seven maturity buckets, in order — the single definition shared by
 *  the ladder aggregate and the per-order bucket key below. */
const bucketDefs = [
  { key: "0-3m", label: "0–3 months", minMonths: 0, maxMonths: 3 },
  { key: "3-6m", label: "3–6 months", minMonths: 3, maxMonths: 6 },
  { key: "6-12m", label: "6–12 months", minMonths: 6, maxMonths: 12 },
  { key: "1-2y", label: "1–2 years", minMonths: 12, maxMonths: 24 },
  { key: "2-5y", label: "2–5 years", minMonths: 24, maxMonths: 60 },
  { key: "5-10y", label: "5–10 years", minMonths: 60, maxMonths: 120 },
  { key: "10y+", label: "10 years+", minMonths: 120, maxMonths: Infinity },
];

/** Whole months from todayIso to a maturity date, floored so "just under
 *  3 months" lands in 0-3m rather than 3-6m. */
function monthsToMaturity(maturityDate: string, todayIso: string): number {
  const today = new Date(todayIso);
  const maturity = new Date(maturityDate);
  let months =
    (maturity.getUTCFullYear() - today.getUTCFullYear()) * 12 +
    (maturity.getUTCMonth() - today.getUTCMonth());
  if (maturity.getUTCDate() < today.getUTCDate()) months--;
  return months;
}

/**
 * The maturity-ladder bucket key for one order, or null if it doesn't have
 * one. Only open (SUBMITTED) BUY orders hold a position with future
 * maturity cash flow — a SELL liquidates a position now rather than
 * holding one, so it never gets a bucket. This is the single source of
 * that rule; maturityLadder() and attachMaturityBucket() both call it, so
 * server and client can never see it applied inconsistently.
 */
export function bucketKeyForOrder(
  order: Pick<Order, "status" | "side" | "maturityDate">,
  todayIso: string,
): string | null {
  if (order.status !== "SUBMITTED" || order.side !== "BUY") return null;
  const months = monthsToMaturity(order.maturityDate, todayIso);
  return bucketDefs.find((b) => months >= b.minMonths && months < b.maxMonths)?.key ?? null;
}

/** Stamps each order with its maturity-ladder bucket key (or null), relative
 *  to todayIso. The one place that gives clients per-order bucket
 *  membership, so they never have to re-derive it. */
export function attachMaturityBucket(orders: Order[], todayIso: string): Order[] {
  return orders.map((order) => ({ ...order, maturityBucket: bucketKeyForOrder(order, todayIso) }));
}

/** Build the maturity ladder: aggregate open BUY orders into time bands by months to maturity. */
export function maturityLadder(todayIso: string): LadderResponse {
  // Initialize all buckets with zero values
  const buckets: { [key: string]: MaturityBucket } = {};
  for (const def of bucketDefs) {
    buckets[def.key] = {
      key: def.key,
      label: def.label,
      notionalMinor: 0,
      orderCount: 0,
    };
  }

  // Aggregate open orders into buckets
  let totalMinor = 0;
  let weightedSum = 0;

  const orders = listOrders();
  for (const order of orders) {
    const key = bucketKeyForOrder(order, todayIso);
    if (!key) continue;

    const months = monthsToMaturity(order.maturityDate, todayIso);
    buckets[key]!.notionalMinor += order.amountMinor;
    buckets[key]!.orderCount += 1;
    totalMinor += order.amountMinor;
    weightedSum += order.amountMinor * months;
  }

  // Calculate weighted average months to maturity, rounded to 1 decimal place
  const weightedAverageMonths =
    totalMinor > 0 ? Math.round((weightedSum / totalMinor) * 10) / 10 : 0;

  // Return buckets in order, totals, and weighted average
  return {
    buckets: bucketDefs.map((def) => buckets[def.key]!),
    totalMinor,
    weightedAverageMonths,
  };
}
