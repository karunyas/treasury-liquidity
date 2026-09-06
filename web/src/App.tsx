import { useCallback, useEffect, useRef, useState } from "react";
import { cancelOrder, fetchCurve, fetchHoldings, fetchLadder, fetchOrders } from "./lib/api";
import type { CurveResponse, HoldingsResponse, LadderResponse, Order, OrderSide } from "./types";
import { AllOrders } from "./components/AllOrders";
import { CurveTable } from "./components/CurveTable";
import { DeskHeader } from "./components/DeskHeader";
import { MaturityLadder } from "./components/MaturityLadder";
import { OrderForm } from "./components/OrderForm";
import { TodaysOrders } from "./components/TodaysOrders";
import { HoldingsTable } from "./components/HoldingsTable";

/** Stub component for the Portfolio page. */
function Portfolio() {
  return (
    <div className="shell">
      <header className="masthead">
        <div>
          <h1>Treasury Liquidity Desk</h1>
          <p className="masthead-sub">Portfolio</p>
        </div>
      </header>
      <div style={{ padding: "20px" }}>
        <h2>Portfolio Performance</h2>
        <p>Portfolio view coming soon.</p>
      </div>
    </div>
  );
}

/**
 * The page keeps itself current; there is no refresh button. The server holds
 * the curve for five minutes and the page re-asks every minute, so a newly
 * published curve lands within about six minutes worst case.
 */
const POLL_MS = 60 * 1000;

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export default function App() {
  const route = useHashRoute();
  const showAll = route.startsWith("#/orders");
  const showPortfolio = route.startsWith("#/portfolio");

  // Navigation helper for DeskHeader buttons
  const navigate = (hash: string) => {
    window.location.hash = hash;
  };

  const [curve, setCurve] = useState<CurveResponse | null>(null);
  const [curveError, setCurveError] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [tenorKey, setTenorKey] = useState("10Y");
  const [confirming, setConfirming] = useState(false);

  const [ladder, setLadder] = useState<LadderResponse | null>(null);
  /** Set when a blotter row is repeated; the nonce makes re-repeating the
   *  same order fire again rather than being swallowed as an equal value. */
  const [prefill, setPrefill] = useState<
    { side: OrderSide; amountMinor: number; nonce: number } | null
  >(null);

  const [today, setToday] = useState<Order[]>([]);
  const [all, setAll] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const seenAsOf = useRef<string | null>(null);
  const [holdings, setHoldings] = useState<HoldingsResponse | null>(null);

  const loadCurve = useCallback(async () => {
    try {
      const next = await fetchCurve();
      seenAsOf.current = next.meta.asOfDate;
      setCurve(next);
      setLastCheckedAt(new Date());
      setCurveError(null);
    } catch (error) {
      setCurveError(error instanceof Error ? error.message : "Could not load the curve");
    }
  }, []);

  const loadOrders = useCallback(async () => {
    try {
      const [todayResult, allResult, ladderResult, holdingsResult] = await Promise.all([
        fetchOrders("today"),
        fetchOrders("all"),
        fetchLadder(),
        fetchHoldings(),
      ]);
      setToday(todayResult.orders);
      setAll(allResult.orders);
      setLadder(ladderResult);
      setHoldings(holdingsResult);
    } catch {
      // A failed poll leaves the last good blotter on screen.
    }
  }, []);

  /**
   * Repeat copies the trade, never the price: side, term and size come from
   * the row, but the ticket re-quotes at today's yield. Blocked mid-confirm
   * for the same reason the curve is — nothing may rewrite a trade being
   * reviewed.
   */
  const handleRepeat = useCallback(
    (order: Order) => {
      if (confirming) return;
      setTenorKey(order.tenorKey);
      setPrefill({ side: order.side, amountMinor: order.amountMinor, nonce: Date.now() });
      // If viewing all-orders, navigate back to the desk so the form is visible.
      if (window.location.hash.startsWith("#/orders")) {
        window.location.hash = "#/";
      }
      // Scroll after a frame so the form has rendered.
      requestAnimationFrame(() => {
        document.getElementById("ticket-heading")?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    },
    [confirming],
  );

  useEffect(() => {
    void loadCurve();
    void loadOrders().finally(() => setLoading(false));
  }, [loadCurve, loadOrders]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void loadCurve();
        void loadOrders();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadCurve();
      void loadOrders();
    }, POLL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(id);
    };
  }, [loadCurve, loadOrders]);

  const handleCancel = useCallback(async (id: string) => {
    const { order } = await cancelOrder(id);
    const swap = (list: Order[]) => list.map((o) => (o.id === order.id ? order : o));
    setToday(swap);
    setAll(swap);
  }, []);

  // Optimistic insert: the row shows as pending the moment it is sent.
  const handlePlacing = useCallback((draft: Order) => {
    setToday((previous) => [draft, ...previous]);
  }, []);

  const handleResolved = useCallback((draftId: string, order: Order | null) => {
    setToday((previous) => {
      const without = previous.filter((o) => o.id !== draftId);
      return order ? [order, ...without] : without;
    });
    if (order) setAll((previous) => [order, ...previous]);
  }, []);

  if (showAll) {
    return (
      <AllOrders orders={all} loading={loading} ladder={ladder} onCancel={handleCancel} onRepeat={handleRepeat} />
    );
  }

  if (showPortfolio) {
    return <Portfolio />;
  }
  return (
    <div className="shell">
      {curve ? (
        <DeskHeader
          meta={curve.meta}
          spread={curve.spread2s10s}
          cutoffLabel={null}
          lastCheckedAt={lastCheckedAt}
          navigate={navigate}
          route={route}
        />
      ) : (
        <header className="masthead">
          <div>
            <h1>Treasury Liquidity Desk</h1>
            <p className="masthead-sub">Loading the curve…</p>
          </div>
        </header>
      )}

      {curveError && !curve && (
        <div className="banner banner-error" role="alert" style={{ marginTop: 20 }}>
          {curveError}
        </div>
      )}

      {/* Two-column layout: curve + blotter share the left column so the
          blotter is visible without scrolling; order form + ladder on the right. */}
      <div className="columns">
        <div className="col-curve">
          {curve ? (
            <CurveTable
              data={curve}
              selectedTenor={tenorKey}
              onSelectTenor={setTenorKey}
              locked={confirming}
            />
          ) : (
            <section className="card"><p className="empty">Loading the curve…</p></section>
          )}
          <div style={{ marginTop: 20 }}>
            <TodaysOrders
              orders={today}
              loading={loading}
              onCancel={handleCancel}
              onRepeat={handleRepeat}
            />
          </div>
        </div>

        <div className="col-task">
          {curve && (
            <OrderForm
              curve={curve}
              tenorKey={tenorKey}
              onTenorChange={setTenorKey}
              onPlacing={handlePlacing}
              onResolved={handleResolved}
              onRequote={loadCurve}
              onConfirmingChange={setConfirming}
              prefill={prefill}
            />
          )}
          <MaturityLadder ladder={ladder} loading={loading} />
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <HoldingsTable holdings={holdings} loading={loading} />
      </div>

      <footer className="footnote">
        Source: {curve?.meta.source ?? "treasury.gov"} — Treasury publishes one par yield curve per
        business day, derived from indicative closing bid quotations. These are official par rates,
        not live intraday market quotes, so they will not match a continuously updating ticker.
        Projected income is simple, non-compounding, and indicative.
      </footer>
    </div>
  );
}
