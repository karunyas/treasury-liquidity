import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { NewOrder } from "../src/lib/orders.js";
import type { LadderResponse, Order } from "../src/types.js";

/**
 * maturityLadder() and insertOrder() touch a real sqlite file via DB_PATH,
 * read once into a module-level `db` singleton on first import. DB_PATH must
 * be pointed at a scratch directory before that happens, so the module is
 * loaded dynamically here rather than statically — a genuine module-loading
 * boundary, not a stand-in for a static import.
 */
let tmpDir: string;
let insertOrder: (order: NewOrder) => Order;
let maturityLadder: (todayIso: string) => LadderResponse;
let attachMaturityBucket: (orders: Order[], todayIso: string) => Order[];
let isCancellable: (order: Pick<Order, "status" | "settlementDate">, todayIso: string) => boolean;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "ladder-test-"));
  process.env.DB_PATH = join(tmpDir, "test.db");
  const mod = await import("../src/lib/orders.js");
  insertOrder = mod.insertOrder;
  maturityLadder = mod.maturityLadder;
  attachMaturityBucket = mod.attachMaturityBucket;
  isCancellable = mod.isCancellable;
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function order(overrides: Partial<NewOrder>): NewOrder {
  const id = randomUUID();
  return {
    id,
    idempotencyKey: id,
    placedAt: "2026-09-06T12:00:00Z",
    side: "BUY",
    tenorKey: "10Y",
    tenorLabel: "10 Yr",
    tenorMonths: 120,
    amountMinor: 25_000_000_00,
    yieldBps: 478,
    curveAsOf: "2026-09-04",
    settlementDate: "2026-09-09",
    maturityDate: "2036-09-09",
    projectedInterestMinor: 0,
    ...overrides,
  };
}

describe("maturityLadder", () => {
  const today = "2026-09-06T00:00:00Z";

  it("counts an open BUY order in its maturity bucket", () => {
    insertOrder(order({ side: "BUY", amountMinor: 25_000_000_00 }));

    const ladder = maturityLadder(today);
    const bucket = ladder.buckets.find((b) => b.key === "10y+");
    expect(bucket?.notionalMinor).toBe(25_000_000_00);
    expect(ladder.totalMinor).toBe(25_000_000_00);
  });

  it("excludes a SELL order — it liquidates a position, it does not hold one", () => {
    insertOrder(
      order({
        side: "SELL",
        amountMinor: 10_000_000_00,
        tenorKey: "5Y",
        tenorLabel: "5 Yr",
        tenorMonths: 60,
        maturityDate: "2031-09-09",
      }),
    );

    const ladder = maturityLadder(today);
    // Only the prior BUY order's notional should be present; the SELL
    // must not add a second entry to any bucket.
    expect(ladder.totalMinor).toBe(25_000_000_00);
    const fiveYearBucket = ladder.buckets.find((b) => b.key === "5-10y");
    expect(fiveYearBucket?.notionalMinor).toBe(0);
    expect(fiveYearBucket?.orderCount).toBe(0);
  });
});

describe("attachMaturityBucket", () => {
  const today = "2026-09-06T00:00:00Z";

  it("gives an open BUY order its bucket key — what the ladder's click/hover filter reads", () => {
    const buy = insertOrder(order({ side: "BUY", amountMinor: 25_000_000_00 }));

    const [stamped] = attachMaturityBucket([buy], today);
    expect(stamped!.maturityBucket).toBe("10y+");
  });

  it("leaves a SELL order's bucket null — it must never appear as part of cash returning", () => {
    const sell = insertOrder(
      order({ side: "SELL", tenorKey: "5Y", tenorLabel: "5 Yr", tenorMonths: 60, maturityDate: "2031-09-09" }),
    );

    const [stamped] = attachMaturityBucket([sell], today);
    expect(stamped!.maturityBucket).toBeNull();
  });
});

describe("isCancellable", () => {
  it("allows cancelling an open order before its settlement date", () => {
    expect(isCancellable({ status: "SUBMITTED", settlementDate: "2026-09-09" }, "2026-09-06")).toBe(true);
  });

  it("refuses to cancel once settlement date has arrived — the trade has processed", () => {
    expect(isCancellable({ status: "SUBMITTED", settlementDate: "2026-09-06" }, "2026-09-06")).toBe(false);
  });

  it("refuses to cancel after settlement date has passed", () => {
    expect(isCancellable({ status: "SUBMITTED", settlementDate: "2026-08-01" }, "2026-09-06")).toBe(false);
  });

  it("refuses to cancel an order that is already cancelled, regardless of date", () => {
    expect(isCancellable({ status: "CANCELLED", settlementDate: "2026-12-25" }, "2026-09-06")).toBe(false);
  });
});
