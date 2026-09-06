/**
 * Seeds a realistic year of order history against real published curve
 * dates, so a fresh checkout has something in the blotter, ladder, and
 * portfolio to look at instead of an empty screen. The server already
 * pulls two calendar years of Treasury history on first fetch (see
 * yearsToLoad() in curves.ts), so there is a full year of real business
 * days to seed against.
 *
 * Pulls the curve itself first if the DB doesn't have one yet — nothing
 * else needs to be running. Safe to re-run: skips if seed orders already
 * exist. Never fails setup — a network hiccup here just means an empty
 * ledger, not a broken install.
 *
 * Run: npx tsx server/scripts/seed.ts   (or: npm run seed)
 */
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Anchored to this script's location rather than the caller's cwd, so it
// resolves the same DB whether run from the repo root (npm run seed) or
// mid-install from setup.sh.
const here = dirname(fileURLToPath(import.meta.url));
process.env.DB_PATH ??= resolve(here, "../../data/desk.db");

// DB_PATH must land in the environment before database.ts's module-level
// singleton reads it — a genuine module-loading boundary, not a stand-in
// for a static import.
const { refreshFromSource } = await import("../src/lib/curves.js");
const { db } = await import("../src/lib/database.js");

const TENORS: Record<string, { label: string; months: number }> = {
  "3M": { label: "3 Mo", months: 3 },
  "6M": { label: "6 Mo", months: 6 },
  "1Y": { label: "1 Yr", months: 12 },
  "2Y": { label: "2 Yr", months: 24 },
  "5Y": { label: "5 Yr", months: 60 },
  "10Y": { label: "10 Yr", months: 120 },
  "30Y": { label: "30 Yr", months: 360 },
};
const TENOR_KEYS = Object.keys(TENORS);

function addMonths(from: Date, months: number): Date {
  const whole = Math.floor(months);
  const out = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  const targetDay = out.getUTCDate();
  out.setUTCMonth(out.getUTCMonth() + whole);
  if (out.getUTCDate() !== targetDay) out.setUTCDate(0);
  const fractionDays = Math.round((months - whole) * 30);
  if (fractionDays) out.setUTCDate(out.getUTCDate() + fractionDays);
  return out;
}

function nextBusinessDay(d: Date): Date {
  const out = new Date(d);
  const dow = out.getUTCDay();
  if (dow === 6) out.setUTCDate(out.getUTCDate() + 2);
  else if (dow === 0) out.setUTCDate(out.getUTCDate() + 1);
  return out;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  if (db.prepare(`SELECT 1 FROM orders WHERE idempotency_key LIKE 'seed-%' LIMIT 1`).get()) {
    console.log("[seed] Demo orders already present — skipping (delete data/desk.db to reseed).");
    return;
  }

  console.log("[seed] Fetching the curve (up to two years of history)...");
  await refreshFromSource();

  const allDates = (
    db.prepare(`SELECT DISTINCT as_of_date FROM curve_points ORDER BY as_of_date ASC`).all() as {
      as_of_date: string;
    }[]
  ).map((r) => r.as_of_date);

  if (allDates.length === 0) {
    console.warn("[seed] No curve data available (Treasury's feed could not be reached). Nothing seeded.");
    return;
  }

  const latest = allDates[allDates.length - 1]!;
  const oneYearBack = toIso(new Date(new Date(`${latest}T00:00:00Z`).getTime() - 365 * 86_400_000));
  const yearOfDates = allDates.filter((d) => d >= oneYearBack);

  // ~24 orders, roughly one every two weeks, oldest first — enough for a
  // year-shaped blotter and ladder without seeding every single business day.
  const orderCount = Math.min(24, yearOfDates.length);
  const orderDates: string[] = [];
  for (let i = 0; i < orderCount; i++) {
    const idx = Math.round((i * (yearOfDates.length - 1)) / Math.max(1, orderCount - 1));
    orderDates.push(yearOfDates[idx]!);
  }

  // Build a plan: mostly buys spread across tenors, with an occasional sell
  // trimming a tenor once it's been bought at least twice — a book that
  // grows over the year rather than a static pile.
  const boughtCount = new Map<string, number>();
  const plan: Array<{ curveDate: string; tenorKey: string; side: "BUY" | "SELL"; amountUsd: number; hourUtc: number }> = [];
  for (let i = 0; i < orderDates.length; i++) {
    const curveDate = orderDates[i]!;
    const tenorKey = TENOR_KEYS[i % TENOR_KEYS.length]!;
    const amountUsd = 10_000_000 + ((i * 5_000_000) % 40_000_000);
    const bought = boughtCount.get(tenorKey) ?? 0;
    const side: "BUY" | "SELL" = bought >= 2 && i % 5 === 4 ? "SELL" : "BUY";
    if (side === "BUY") boughtCount.set(tenorKey, bought + 1);
    plan.push({ curveDate, tenorKey, side, amountUsd, hourUtc: 14 + (i % 4) });
  }

  const getYield = db.prepare(`SELECT yield_bps FROM curve_points WHERE as_of_date = ? AND tenor_key = ?`);
  const insertOrder = db.prepare(`
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
  const insertEvent = db.prepare(`INSERT INTO order_events (order_id, event, occurred_at) VALUES (?, 'SUBMITTED', ?)`);

  const seed = db.transaction(() => {
    let count = 0;
    for (const row of plan) {
      const tenor = TENORS[row.tenorKey]!;
      const yieldRow = getYield.get(row.curveDate, row.tenorKey) as { yield_bps: number } | undefined;
      if (!yieldRow) {
        console.warn(`[seed] skip: no yield for ${row.tenorKey} on ${row.curveDate}`);
        continue;
      }

      const yieldBps = yieldRow.yield_bps;
      const amountMinor = row.amountUsd * 100;
      const curveDate = new Date(`${row.curveDate}T00:00:00Z`);
      const settlement = nextBusinessDay(new Date(curveDate.getTime() + 86_400_000));
      const maturity = nextBusinessDay(addMonths(settlement, tenor.months));
      const projectedInterestMinor = Math.round((amountMinor * yieldBps * tenor.months) / (10_000 * 12));
      const placedAt = new Date(`${row.curveDate}T${String(row.hourUtc).padStart(2, "0")}:00:00Z`).toISOString();

      const id = randomUUID();
      insertOrder.run({
        id,
        idempotencyKey: `seed-${id}`,
        placedAt,
        side: row.side,
        tenorKey: row.tenorKey,
        tenorLabel: tenor.label,
        tenorMonths: tenor.months,
        amountMinor,
        yieldBps,
        curveAsOf: row.curveDate,
        settlementDate: toIso(settlement),
        maturityDate: toIso(maturity),
        projectedInterestMinor,
      });
      insertEvent.run(id, placedAt);
      count++;

      console.log(
        `[seed]   ${row.side} $${row.amountUsd.toLocaleString("en-US")} ${tenor.label} @ ` +
          `${(yieldBps / 100).toFixed(2)}% on ${row.curveDate}`,
      );
    }
    return count;
  });

  const n = seed();
  console.log(`[seed] Done: ${n} orders inserted across ${orderDates[0]} \u2192 ${orderDates[orderDates.length - 1]}.`);
}

try {
  await main();
} catch (error) {
  // Seeding is a nice-to-have, never a reason to fail setup.
  console.warn(`[seed] Skipped: ${error instanceof Error ? error.message : String(error)}`);
}
