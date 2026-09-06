import type { OrderQuote } from "../types.js";
import {
  bookingWindow,
  holidaysBetween,
  nextBusinessDay,
  rollToBusinessDay,
  toIsoDate,
} from "./calendar.js";
import { getLiveYieldBps } from "./curves.js";
import { heldAtTenorMinor } from "./orders.js";
import { TENOR_BY_KEY, addMonths } from "./tenors.js";
import { simpleInterestMinor } from "./units.js";

/**
 * The single place order economics are computed.
 *
 * Both the ticket preview and the booking itself go through here, so the
 * figures a trader reads are the figures that get written — there is no second
 * implementation on the client to drift out of step.
 */
export async function quoteOrder(tenorKey: string, amountMinor: number): Promise<OrderQuote> {
  const tenor = TENOR_BY_KEY.get(tenorKey);
  if (!tenor) {
    throw Object.assign(new Error(`Unknown tenor "${tenorKey}"`), { status: 400 });
  }

  const { yieldBps, curveAsOf } = await getLiveYieldBps(tenorKey);

  // Past the desk cutoff an order books on the next business day, which carries
  // settlement out with it. The cutoff moves the date; it does not block.
  const window = bookingWindow();
  const settlement = nextBusinessDay(new Date(`${window.bookingDate}T00:00:00Z`));
  const settlementIso = toIsoDate(settlement);
  const maturity = rollToBusinessDay(addMonths(settlement, tenor.months));

  // Collect all holidays skipped rolling from booking date to settlement date
  const bookingToSettlement = holidaysBetween(window.bookingDate, settlementIso);

  // Combine window holidays with booking-to-settlement holidays, de-duplicate by date
  const allHolidays = [...window.skippedHolidays, ...bookingToSettlement];
  const holidayMap = new Map(allHolidays.map((h) => [h.date, h]));
  const skippedHolidays = Array.from(holidayMap.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return {
    tenorKey: tenor.key,
    tenorLabel: tenor.label,
    tenorMonths: tenor.months,
    amountMinor,
    yieldBps,
    curveAsOf,
    settlementDate: settlementIso,
    maturityDate: toIsoDate(maturity),
    annualIncomeMinor: simpleInterestMinor(amountMinor, yieldBps, 12),
    projectedInterestMinor: simpleInterestMinor(amountMinor, yieldBps, tenor.months),
    heldAtTenorMinor: heldAtTenorMinor(tenor.key),
    bookingDate: window.bookingDate,
    bookingReason: window.reason,
    cutoffLabel: window.cutoffLabel,
    skippedHolidays,
  };
}
