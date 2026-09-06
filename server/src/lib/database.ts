import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : resolve(process.cwd(), "../data/desk.db");

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  /* One row per tenor per business date.
     as_of_date, fetched_at and source are three different facts and are
     stored separately: when the curve applies, when we pulled it, where from. */
  CREATE TABLE IF NOT EXISTS curve_points (
    as_of_date TEXT    NOT NULL,
    tenor_key  TEXT    NOT NULL,
    yield_bps  INTEGER NOT NULL,
    source     TEXT    NOT NULL,
    fetched_at TEXT    NOT NULL,
    PRIMARY KEY (as_of_date, tenor_key)
  );

  /* Orders are immutable once written. Anything that changes about an order
     is an appended event, never an UPDATE to this row. */
  CREATE TABLE IF NOT EXISTS orders (
    id                       TEXT    PRIMARY KEY,
    idempotency_key          TEXT    NOT NULL UNIQUE,
    placed_at                TEXT    NOT NULL,
    side                     TEXT    NOT NULL CHECK (side IN ('BUY','SELL')),
    tenor_key                TEXT    NOT NULL,
    tenor_label              TEXT    NOT NULL,
    tenor_months             REAL    NOT NULL,
    amount_minor             INTEGER NOT NULL CHECK (amount_minor > 0),
    yield_bps                INTEGER NOT NULL,
    curve_as_of              TEXT    NOT NULL,
    settlement_date          TEXT    NOT NULL,
    maturity_date            TEXT    NOT NULL,
    projected_interest_minor INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS order_events (
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id    TEXT    NOT NULL REFERENCES orders(id),
    event       TEXT    NOT NULL CHECK (event IN ('SUBMITTED','CANCELLED')),
    occurred_at TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_orders_placed_at   ON orders (placed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_events_order       ON order_events (order_id, seq);
`);

/**
 * Databases from before integer units and the event log used float dollars and
 * a mutable status column. Rather than pretend those rows can be converted
 * faithfully, they are set aside under a suffixed name and the log says so.
 */
{
  const legacy = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='orders'`)
    .get() as { name: string } | undefined;

  if (legacy) {
    const columns = new Set(
      (db.prepare("PRAGMA table_info(orders)").all() as { name: string }[]).map((c) => c.name),
    );
    if (columns.has("amount_usd")) {
      const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
      db.exec(`ALTER TABLE orders RENAME TO orders_pre_integer_units_${stamp}`);
      console.warn(
        `[db] Found a pre-integer-units orders table. Preserved as ` +
          `orders_pre_integer_units_${stamp}; starting a fresh blotter.`,
      );
    }
  }
}
