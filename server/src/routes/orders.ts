import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { bookingWindow, deskDayStartUtc, toIsoDate } from "../lib/calendar.js";
import { yieldMoved } from "../lib/curves.js";
import {
  attachMaturityBucket,
  cancelOrder,
  getOrder,
  getOrderByIdempotencyKey,
  isCancellable,
  listOrders,
  listOrdersSince,
  maturityLadder,
  medianOrderMinor,
  orderEvents,
  insertOrder,
} from "../lib/orders.js";
import { quoteOrder } from "../lib/quote.js";
import { TENOR_BY_KEY } from "../lib/tenors.js";
import { latestStoredCurve } from "../lib/curveStore.js";
import type { Order, Holding, HoldingsResponse } from "../types.js";

export const ordersRouter = Router();

/** A ticket more than this multiple of the running median gets flagged. */
const LARGE_ORDER_MULTIPLE = Number(process.env.LARGE_ORDER_MULTIPLE ?? 3);

function sizing(amountMinor: number) {
  const medianMinor = medianOrderMinor();
  return {
    medianMinor,
    unusuallyLarge: medianMinor !== null && amountMinor > medianMinor * LARGE_ORDER_MULTIPLE,
  };
}

const orderInput = z.object({
  /** Client-generated, so a retried submission cannot double-book. */
  idempotencyKey: z.string().min(8).max(200),
  side: z.enum(["BUY", "SELL"]),
  tenorKey: z.string().refine((key) => TENOR_BY_KEY.has(key), { message: "Unknown tenor" }),
  amountMinor: z
    .number({ invalid_type_error: "Amount must be a number" })
    .int("Amount must be a whole number of minor units")
    .positive(),
  /** Price assertion: the yield the trader was shown, in bps. */
  expectedYieldBps: z.number().int().nonnegative().optional(),
});

/** GET /api/orders/preview?tenorKey=10Y&amountMinor=2500000000 */
ordersRouter.get("/preview", async (req, res, next) => {
  try {
    const tenorKey = typeof req.query.tenorKey === "string" ? req.query.tenorKey : "";
    const amountMinor = Number(req.query.amountMinor);
    if (!TENOR_BY_KEY.has(tenorKey)) {
      res.status(400).json({ error: "Unknown tenor" });
      return;
    }
    if (!Number.isFinite(amountMinor) || amountMinor < 0) {
      res.status(400).json({ error: "Invalid amount" });
      return;
    }
    res.json({ quote: await quoteOrder(tenorKey, amountMinor), sizing: sizing(amountMinor) });
  } catch (error) {
    next(error);
  }
});

/** GET /api/orders?scope=today|all */
ordersRouter.get("/", (req, res, next) => {
  try {
    const scope = req.query.scope === "today" ? "today" : "all";
    const orders =
      scope === "today"
        ? listOrdersSince(deskDayStartUtc(bookingWindow().deskDate).toISOString())
        : listOrders();
    const isoDate = bookingWindow().deskDate + "T00:00:00Z";
    res.json({ orders: attachMaturityBucket(orders, isoDate), scope });
  } catch (error) {
    next(error);
  }
});

/** GET /api/orders/ladder — maturity ladder for liquidity management. */
ordersRouter.get("/ladder", (_req, res, next) => {
  try {
    const deskDate = bookingWindow().deskDate;
    // Convert desk date (YYYY-MM-DD) to ISO string for calculation
    const isoDate = deskDate + "T00:00:00Z";
    const ladder = maturityLadder(isoDate);
    res.json(ladder);
  } catch (error) {
    next(error);
  }
});

/** GET /api/orders/holdings — mark-to-market on open positions. */
ordersRouter.get("/holdings", (_req, res, next) => {
  try {
    const todayIso = toIsoDate(new Date());
    const allOrders = listOrders();
    
    // Filter for open BUY orders
    const openBuyOrders = allOrders.filter(
      (order) => order.status === "SUBMITTED" && order.side === "BUY"
    );

    // Get the latest curve
    const curve = latestStoredCurve();
    const curveYields = new Map(curve?.points.map((p) => [p.tenorKey, p.yieldBps]) ?? []);

    // Calculate holdings
    const holdings: Holding[] = openBuyOrders.map((order) => {
      // Days held since settlement
      const settlementDate = new Date(order.settlementDate);
      const today = new Date(todayIso);
      const daysHeld = Math.max(
        0,
        Math.floor((today.getTime() - settlementDate.getTime()) / (1000 * 60 * 60 * 24))
      );

      // Accrued interest
      const accruedInterestMinor = Math.floor(
        (order.amountMinor * order.yieldBps * daysHeld) / (10000 * 365)
      );

      // Current yield and unrealized P&L
      const currentYieldBps = curveYields.get(order.tenorKey) ?? null;
      let unrealizedPnlMinor = 0;

      if (currentYieldBps !== null) {
        // Calculate months remaining
        const maturityDate = new Date(order.maturityDate);
        let monthsRemaining =
          (maturityDate.getFullYear() - today.getFullYear()) * 12 +
          (maturityDate.getMonth() - today.getMonth());
        if (maturityDate.getDate() < today.getDate()) {
          monthsRemaining--;
        }
        monthsRemaining = Math.max(0, monthsRemaining);

        const yearsRemaining = monthsRemaining / 12;

        // Modified duration (par bond approximation)
        const modifiedDuration = yearsRemaining / (1 + currentYieldBps / 10000);

        // Yield change
        const yieldChangeBps = currentYieldBps - order.yieldBps;

        // Unrealized P&L = -modifiedDuration * (yieldChangeBps / 10000) * notional
        unrealizedPnlMinor = Math.floor(
          (-modifiedDuration * (yieldChangeBps / 10000) * order.amountMinor)
        );
      }

      const totalReturnMinor = accruedInterestMinor + unrealizedPnlMinor;

      return {
        orderId: order.id,
        tenorKey: order.tenorKey,
        tenorLabel: order.tenorLabel,
        side: order.side,
        notionalMinor: order.amountMinor,
        purchaseYieldBps: order.yieldBps,
        currentYieldBps,
        purchaseDate: order.placedAt,
        settlementDate: order.settlementDate,
        maturityDate: order.maturityDate,
        daysHeld,
        accruedInterestMinor,
        unrealizedPnlMinor,
        totalReturnMinor,
      };
    });

    // Calculate totals
    const totalNotionalMinor = holdings.reduce((sum, h) => sum + h.notionalMinor, 0);
    const totalAccruedMinor = holdings.reduce((sum, h) => sum + h.accruedInterestMinor, 0);
    const totalUnrealizedPnlMinor = holdings.reduce(
      (sum, h) => sum + h.unrealizedPnlMinor,
      0
    );
    const totalReturnMinor = holdings.reduce((sum, h) => sum + h.totalReturnMinor, 0);

    const response: HoldingsResponse = {
      holdings,
      totalNotionalMinor,
      totalAccruedMinor,
      totalUnrealizedPnlMinor,
      totalReturnMinor,
      curveAsOf: curve?.asOfDate ?? new Date().toISOString().slice(0, 10),
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
});

/** GET /api/orders/:id/events — the append-only history behind an order. */
ordersRouter.get("/:id/events", (req, res, next) => {
  try {
    const order = getOrder(req.params.id);
    if (!order) {
      res.status(404).json({ error: "No such order", code: "NOT_FOUND" });
      return;
    }
    res.json({ events: orderEvents(order.id) });
  } catch (error) {
    next(error);
  }
});

/** POST /api/orders — the server, not the client, stamps price and dates. */
ordersRouter.post("/", async (req, res, next) => {
  try {
    const parsed = orderInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid order",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    const { idempotencyKey, side, tenorKey, amountMinor, expectedYieldBps } = parsed.data;

    // A retry of a submission we already booked returns the original, so a
    // double-click or a network retry cannot place two orders.
    const existing = getOrderByIdempotencyKey(idempotencyKey);
    if (existing) {
      res.status(200).json({ order: existing, replayed: true });
      return;
    }

    const tenor = TENOR_BY_KEY.get(tenorKey)!;
    const quote = await quoteOrder(tenorKey, amountMinor);

    // Cannot sell more than you hold at this tenor.
    if (side === "SELL") {
      const held = quote.heldAtTenorMinor;
      if (amountMinor > held) {
        res.status(422).json({
          error:
            held === 0
              ? `You have no open position in ${tenor.label} to sell.`
              : `You hold ${(held / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} ` +
                `in ${tenor.label} but tried to sell ` +
                `${(amountMinor / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })}. ` +
                `Reduce the amount or cancel the sell.`,
          code: "EXCEEDS_POSITION",
          heldMinor: held,
          requestedMinor: amountMinor,
        });
        return;
      }
    }

    // A new curve published between the ticket being drawn and the order
    // arriving. Refuse and re-quote — never fill at an unseen rate.
    if (expectedYieldBps !== undefined && yieldMoved(expectedYieldBps, quote.yieldBps)) {
      res.status(409).json({
        error:
          `The ${tenor.label} yield moved from ${(expectedYieldBps / 100).toFixed(2)}% to ` +
          `${(quote.yieldBps / 100).toFixed(2)}% before your order reached the desk. ` +
          `Nothing was submitted.`,
        code: "YIELD_MOVED",
        expectedYieldBps,
        actualYieldBps: quote.yieldBps,
        curveAsOf: quote.curveAsOf,
      });
      return;
    }

    const order: Omit<Order, "maturityBucket"> = {
      id: randomUUID(),
      placedAt: new Date().toISOString(),
      side,
      tenorKey: quote.tenorKey,
      tenorLabel: quote.tenorLabel,
      tenorMonths: quote.tenorMonths,
      amountMinor: quote.amountMinor,
      yieldBps: quote.yieldBps,
      curveAsOf: quote.curveAsOf,
      settlementDate: quote.settlementDate,
      maturityDate: quote.maturityDate,
      projectedInterestMinor: quote.projectedInterestMinor,
      status: "SUBMITTED",
      cancelledAt: null,
    };

    res.status(201).json({ order: insertOrder({ ...order, idempotencyKey }) });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/orders/:id/cancel
 *
 * Appends a CANCELLED event. The order row is never modified — status is
 * always derived from the event log.
 */
ordersRouter.post("/:id/cancel", (req, res, next) => {
  try {
    const existing = getOrder(req.params.id);
    if (!existing) {
      res.status(404).json({ error: "No such order", code: "NOT_FOUND" });
      return;
    }
    // Once settlement has happened the trade is done — there is nothing left
    // to cancel, only a position to sell. Real Treasury purchases have the
    // same shape: cancel only works before the auction closes or before the
    // transaction processes; after that, the only way out is a new trade.
    const deskDate = bookingWindow().deskDate;
    if (existing.status === "SUBMITTED" && !isCancellable(existing, deskDate)) {
      res.status(409).json({
        error: `This order already settled on ${existing.settlementDate}. It can no longer be cancelled — sell the position instead.`,
        code: "ALREADY_SETTLED",
        order: existing,
      });
      return;
    }
    const cancelled = cancelOrder(existing.id, new Date().toISOString());
    if (!cancelled) {
      res.status(409).json({
        error: "That order was already cancelled.",
        code: "ALREADY_CANCELLED",
        order: existing,
      });
      return;
    }
    res.json({ order: cancelled });
  } catch (error) {
    next(error);
  }
});
