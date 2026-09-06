import { useMemo, useState } from "react";
import type { LadderResponse, Order } from "../types";
import { formatMinor } from "../lib/format";
import { MaturityLadder } from "./MaturityLadder";
import { OrdersTable } from "./OrdersTable";
import { Dropdown } from "./Dropdown";

interface Props {
  orders: Order[];
  loading: boolean;
  ladder: LadderResponse | null;
  onCancel: (id: string) => Promise<void>;
  onRepeat?: (order: Order) => void;
}

const ALL = "ALL";

export function AllOrders({ orders, loading, ladder, onCancel, onRepeat }: Props) {
  const [side, setSide] = useState(ALL);
  const [tenor, setTenor] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [activeBucket, setActiveBucket] = useState<string | null>(null);
  const [hoveredBucket, setHoveredBucket] = useState<string | null>(null);

  // Tenor definitions in duration order (mirrors server tenors)
  const TENOR_ORDER: Record<string, number> = {
    "1M": 1, "1.5M": 1.5, "2M": 2, "3M": 3, "4M": 4, "6M": 6,
    "1Y": 12, "2Y": 24, "3Y": 36, "5Y": 60, "7Y": 84, "10Y": 120, "20Y": 240, "30Y": 360,
  };

  const tenors = useMemo(
    () => {
      const entries = [...new Map(orders.map((o) => [o.tenorKey, o.tenorLabel])).entries()];
      return entries.sort((a, b) => (TENOR_ORDER[a[0]] ?? 999) - (TENOR_ORDER[b[0]] ?? 999));
    },
    [orders],
  );

  // Bucket membership is server-computed (attachMaturityBucket) — reading
  // it here instead of re-deriving keeps the SUBMITTED/BUY rule in one
  // place, so client and server can never disagree about which orders
  // belong to a maturity bucket.
  const orderBuckets = useMemo(
    () => new Map(orders.map((o) => [o.id, o.maturityBucket])),
    [orders],
  );

  const filtered = orders.filter(
    (o) =>
      (side === ALL || o.side === side) &&
      (tenor === ALL || o.tenorKey === tenor) &&
      (status === ALL || o.status === status) &&
      (activeBucket === null || orderBuckets.get(o.id) === activeBucket),
  );
  const notional = filtered.reduce((sum, o) => sum + o.amountMinor, 0);

  // IDs to highlight on hover (only when not already click-filtered to that bucket).
  const highlightedIds = useMemo(() => {
    if (!hoveredBucket || hoveredBucket === activeBucket) return undefined;
    const ids = new Set<string>();
    for (const o of filtered) {
      if (orderBuckets.get(o.id) === hoveredBucket) ids.add(o.id);
    }
    return ids.size > 0 ? ids : undefined;
  }, [hoveredBucket, activeBucket, filtered, orderBuckets]);

  function handleClickBucket(key: string) {
    setActiveBucket((prev) => (prev === key ? null : key));
    // A bucket click means "show me what's in this bucket" — any Side/Term/
    // Status filter left over from before would silently hide matches, or
    // empty the table if it excludes every order in the bucket.
    setSide(ALL);
    setTenor(ALL);
    setStatus(ALL);
  }

  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <h1>All orders</h1>
          <p className="masthead-sub">
            <a href="#/">← Back to the desk</a>
          </p>
        </div>
        <div className="asof">
          <div className="asof-primary">
            {filtered.length} of {orders.length}
          </div>
          <div className="asof-secondary">{formatMinor(notional)} shown</div>
        </div>
      </header>

      <div className="all-orders-layout">
        <section className="card" style={{ marginTop: 20, flex: 1, minWidth: 0 }}>
          <div className="filters">
            <div style={{ minWidth: 140 }}>
              <Dropdown
                label="Side"
                value={side}
                onChange={setSide}
                options={[
                  { value: ALL, label: "All" },
                  { value: "BUY", label: "Buy" },
                  { value: "SELL", label: "Sell" },
                ]}
              />
            </div>

            <div style={{ minWidth: 140 }}>
              <Dropdown
                label="Term"
                value={tenor}
                onChange={setTenor}
                options={[
                  { value: ALL, label: "All" },
                  ...tenors.map(([key, label]) => ({ value: key, label })),
                ]}
              />
            </div>

            <div style={{ minWidth: 140 }}>
              <Dropdown
                label="Maturity"
                value={activeBucket ?? ALL}
                onChange={(v) => setActiveBucket(v === ALL ? null : v)}
                options={[
                  { value: ALL, label: "All" },
                  ...(ladder?.buckets.map((b) => ({ value: b.key, label: b.label })) ?? []),
                ]}
              />
            </div>

            <div style={{ minWidth: 140 }}>
              <Dropdown
                label="Status"
                value={status}
                onChange={setStatus}
                options={[
                  { value: ALL, label: "All" },
                  { value: "SUBMITTED", label: "Submitted" },
                  { value: "CANCELLED", label: "Cancelled" },
                ]}
              />
            </div>

            {(side !== ALL || tenor !== ALL || status !== ALL || activeBucket !== null) && (
              <button
                type="button"
                className="link-muted"
                style={{ alignSelf: "flex-end", marginBottom: 2 }}
                onClick={() => {
                  setSide(ALL);
                  setTenor(ALL);
                  setStatus(ALL);
                  setActiveBucket(null);
                }}
              >
                Clear all filters
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <p className="empty">
              {loading
                ? "Loading…"
                : orders.length === 0
                  ? "Place your first order from the desk."
                  : "No orders match these filters. Widen them to see more."}
            </p>
          ) : (
            <OrdersTable
              orders={filtered}
              onCancel={onCancel}
              onRepeat={onRepeat}
              highlightedIds={highlightedIds}
            />
          )}
        </section>

        <div style={{ marginTop: 20, width: 300, flexShrink: 0 }}>
          <MaturityLadder
            ladder={ladder}
            loading={loading}
            activeBucket={activeBucket}
            onHoverBucket={setHoveredBucket}
            onClickBucket={handleClickBucket}
          />
        </div>
      </div>
    </div>
  );
}
