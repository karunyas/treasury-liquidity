import { useState, useRef, useEffect } from "react";
import type { Order } from "../types";
import { formatBps, formatDate, formatMinor, formatTimestamp } from "../lib/format";

interface Props {
  orders: Order[];
  onCancel: (id: string) => Promise<void>;
  onRepeat?: (order: Order) => void;
  /** Today's strip drops columns that only matter when reviewing history. */
  compact?: boolean;
  /** Order IDs to visually highlight (e.g. from ladder hover). */
  highlightedIds?: ReadonlySet<string>;
}

export function OrdersTable({ orders, onCancel, onRepeat, compact = false, highlightedIds }: Props) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Once settlement has passed the trade is done — the server rejects a
  // cancel past that point (see POST /:id/cancel), so the button is hidden
  // rather than left to fail on click.
  const todayIso = new Date().toISOString().slice(0, 10);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirmButtonsRef = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (confirmingId && confirmButtonsRef.current?.has(confirmingId)) {
      confirmButtonsRef.current.get(confirmingId)?.focus();
    }
  }, [confirmingId]);

  async function cancel(id: string) {
    setPendingId(id);
    setError(null);
    try {
      await onCancel(id);
      setConfirmingId(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not cancel that order");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      {error && <div className="banner banner-error" role="alert">{error}</div>}
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">Orders, newest first</caption>
          <thead>
            <tr>
              <th scope="col">{compact ? "Time" : "Placed"}</th>
              <th scope="col">Side</th>
              <th scope="col">Term</th>
              <th scope="col" className="num">Amount</th>
              <th scope="col" className="num">Yield</th>
              {!compact && <th scope="col">Settles</th>}
              {!compact && <th scope="col">Matures</th>}
              <th scope="col">Status</th>
              <th scope="col">Confirmation ID</th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const cancelled = order.status === "CANCELLED";
              return (
                <tr
                  key={order.id}
                  className={
                    cancelled ? "row-cancelled"
                    : order.pending ? "row-pending"
                    : highlightedIds?.has(order.id) ? "row-highlight"
                    : undefined
                  }
                >
                  <td>{formatTimestamp(order.placedAt)}</td>
                  <td><span className="pill">{order.side}</span></td>
                  <td>{order.tenorLabel}</td>
                  <td className="num">{formatMinor(order.amountMinor)}</td>
                  <td className="num">{formatBps(order.yieldBps)}</td>
                  {!compact && <td>{formatDate(order.settlementDate)}</td>}
                  {!compact && <td>{formatDate(order.maturityDate)}</td>}
                  <td>
                    {order.pending ? (
                      <span className="pill pill-pending">PENDING</span>
                    ) : (
                      <span className={cancelled ? "pill pill-cancelled" : "pill"}>
                        {order.status}
                      </span>
                    )}
                  </td>
                  <td>{order.id ? order.id.slice(0, 8) : "—"}</td>
                  <td>
                    {order.pending || cancelled ? null : confirmingId === order.id ? (
                      <span className="inline-actions" role="status" aria-live="polite">
                        <button
                          ref={(el) => {
                            if (el) {
                              confirmButtonsRef.current?.set(order.id, el);
                            } else {
                              confirmButtonsRef.current?.delete(order.id);
                            }
                          }}
                          type="button"
                          className="link-danger"
                          disabled={pendingId === order.id}
                          aria-busy={pendingId === order.id}
                          aria-label={`Confirm cancellation of ${order.side} ${formatMinor(order.amountMinor)} ${order.tenorLabel} order`}
                          onClick={() => void cancel(order.id)}
                        >
                          {pendingId === order.id ? "Cancelling…" : "Confirm"}
                        </button>
                        <button
                          type="button"
                          className="link-muted"
                          aria-label={`Keep ${order.side} ${formatMinor(order.amountMinor)} ${order.tenorLabel} order`}
                          onClick={() => setConfirmingId(null)}
                        >
                          Keep
                        </button>
                      </span>
                    ) : (
                      <>
                        {onRepeat && (
                          <button
                            type="button"
                            className="link-muted"
                            aria-label={`Repeat ${order.side} ${formatMinor(order.amountMinor)} ${order.tenorLabel} order`}
                            onClick={() => onRepeat(order)}
                          >
                            Repeat
                          </button>
                        )}
                        {!(order.settlementDate <= todayIso) && (
                          <button
                            type="button"
                            className="link-muted"
                            aria-label={`Cancel ${order.side} ${formatMinor(order.amountMinor)} ${order.tenorLabel} order`}
                            onClick={() => { setError(null); setConfirmingId(order.id); }}
                          >
                            Cancel
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
