import { useEffect, useState } from "react";
import { ApiError, fetchQuote, submitOrder } from "../lib/api";
import {
  amountToWords,
  formatBps,
  formatDate,
  formatDateShort,
  formatMinor,
  formatMinorCompact,
  minorToUnits,
  unitsToMinor,
} from "../lib/format";
import type { CurveResponse, Order, OrderQuote, OrderSide, QuoteSizing } from "../types";

interface Props {
  curve: CurveResponse;
  tenorKey: string;
  onTenorChange: (key: string) => void;
  /** Called the moment the order is sent, with a pending placeholder row. */
  onPlacing: (draft: Order) => void;
  /** Called when the send resolves; a null order removes the placeholder. */
  onResolved: (draftId: string, order: Order | null) => void;
  onRequote: () => Promise<void> | void;
  /** Lets the parent freeze the curve table while a trade is being confirmed. */
  onConfirmingChange: (confirming: boolean) => void;
  /** Set when a blotter row is repeated. The nonce lets the same order be
   *  repeated twice in a row and still re-apply. */
  prefill: { side: OrderSide; amountMinor: number; nonce: number } | null;
}

/**
 * The exact trade the user read and agreed to.
 *
 * Confirm exists to freeze an intent so a human can verify it, so the confirm
 * step renders only from this — never from live curve state. Without it, a
 * click on the curve table behind the dialog silently rewrote the instrument
 * and the yield while "Place order" stayed armed.
 */
interface ConfirmSnapshot {
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
  heldAtTenorMinor: number;
  annualIncomeMinor: number;
  unusuallyLarge: boolean;
  sentence: string;
}

export function OrderForm({
  curve,
  tenorKey,
  onTenorChange,
  onPlacing,
  onResolved,
  onRequote,
  onConfirmingChange,
  prefill,
}: Props) {
  const [side, setSide] = useState<OrderSide>("BUY");
  const [amountText, setAmountText] = useState("25,000,000");
  const [snapshot, setSnapshot] = useState<ConfirmSnapshot | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requote, setRequote] = useState<{ fromBps: number; toBps: number } | null>(null);
  const [placed, setPlaced] = useState<Order | null>(null);

  const [quote, setQuote] = useState<OrderQuote | null>(null);
  const [sizing, setSizing] = useState<QuoteSizing | null>(null);

  const selected = curve.points.find((p) => p.key === tenorKey) ?? curve.points[0]!;
  const units = Number(amountText.replace(/[,$\s]/g, ""));
  const amountMinor = Number.isFinite(units) ? unitsToMinor(units) : NaN;

  const amountValid = Number.isFinite(amountMinor) && amountMinor > 0;

  /**
   * One idempotency key per confirmed intent. A retry — double click, flaky
   * network — reuses it, so the desk books the order once and replays it.
   */
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  // Economics come from the server so the ticket and the booking cannot differ.
  useEffect(() => {
    if (!amountValid) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchQuote(selected.key, amountMinor)
        .then((result) => {
          if (cancelled) return;
          setQuote(result.quote);
          setSizing(result.sizing);
        })
        .catch(() => undefined);
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [selected.key, amountMinor, amountValid, curve.meta.asOfDate]);

  // A quote for a different term than the one selected is stale by definition.
  const shown = quote && quote.tenorKey === selected.key ? quote : null;
  const yieldBps = shown?.yieldBps ?? selected.yieldBps;

  const exceedsPosition =
    side === "SELL" && amountValid && shown != null && amountMinor > shown.heldAtTenorMinor;
  const amountReady = amountValid && !exceedsPosition;

  // Built once, at snapshot time, from the quote the user actually saw.
  function buildSnapshot(quote: OrderQuote): ConfirmSnapshot {
    return {
      side,
      tenorKey: quote.tenorKey,
      tenorLabel: quote.tenorLabel,
      tenorMonths: quote.tenorMonths,
      amountMinor,
      yieldBps: quote.yieldBps,
      curveAsOf: quote.curveAsOf,
      settlementDate: quote.settlementDate,
      maturityDate: quote.maturityDate,
      projectedInterestMinor: quote.projectedInterestMinor,
      heldAtTenorMinor: quote.heldAtTenorMinor,
      annualIncomeMinor: quote.annualIncomeMinor,
      unusuallyLarge: sizing?.unusuallyLarge ?? false,
      sentence:
        `${side === "BUY" ? "Buy" : "Sell"} ${formatMinor(amountMinor)} of ${quote.tenorLabel} ` +
        `Treasuries at ${formatBps(quote.yieldBps)}, settling ${formatDate(quote.settlementDate)}.`,
    };
  }

  useEffect(() => {
    onConfirmingChange(snapshot !== null);
  }, [snapshot, onConfirmingChange]);

  // Repeat copies side and size; the yield is deliberately NOT carried over —
  // the ticket re-quotes so the trade prices at today's curve, not the one it
  // was originally struck on.
  useEffect(() => {
    if (!prefill) return;
    setSide(prefill.side);
    setAmountText(minorToUnits(prefill.amountMinor).toLocaleString("en-US"));
    setPlaced(null);
    setError(null);
    setRequote(null);
  }, [prefill?.nonce]);

  // Allow Escape to close the confirm dialog.
  useEffect(() => {
    if (snapshot === null || submitting) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSnapshot(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [snapshot, submitting]);

  async function place(trade: ConfirmSnapshot) {
    setSubmitting(true);
    setError(null);
    setRequote(null);

    // Show it immediately, marked pending, keyed by the idempotency key.
    const draftId = idempotencyKey;
    onPlacing({
      id: draftId,
      placedAt: new Date().toISOString(),
      side: trade.side,
      tenorKey: trade.tenorKey,
      tenorLabel: trade.tenorLabel,
      tenorMonths: trade.tenorMonths,
      amountMinor: trade.amountMinor,
      yieldBps: trade.yieldBps,
      curveAsOf: trade.curveAsOf,
      settlementDate: trade.settlementDate,
      maturityDate: trade.maturityDate,
      projectedInterestMinor: trade.projectedInterestMinor,
      status: "SUBMITTED",
      cancelledAt: null,
      // Unknown until the server confirms and stamps it; see attachMaturityBucket().
      maturityBucket: null,
      pending: true,
    });

    try {
      const { order } = await submitOrder({
        idempotencyKey,
        side: trade.side,
        tenorKey: trade.tenorKey,
        amountMinor: trade.amountMinor,
        expectedYieldBps: trade.yieldBps,
      });
      setPlaced(order);
      onResolved(draftId, order);
      setSnapshot(null);
      setIdempotencyKey(crypto.randomUUID());
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === "YIELD_MOVED") {
        setPlaced(null);
        onResolved(draftId, null);
        setRequote({
          fromBps: Number(caught.body?.expectedYieldBps),
          toBps: Number(caught.body?.actualYieldBps),
        });
        setSnapshot(null);
        setIdempotencyKey(crypto.randomUUID());
        await onRequote();
        return;
      }
      onResolved(draftId, null);
      setError(
        caught instanceof ApiError && caught.details.length
          ? caught.details.map((d) => d.message).join(" · ")
          : caught instanceof Error
            ? caught.message
            : "Could not place the order",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="card" aria-labelledby="ticket-heading">
      <div className="card-head">
        <h2 id="ticket-heading">New order</h2>
      </div>

      {placed && (
        <div className="banner banner-good" role="status">
          <strong>Order confirmed: #{placed.id.slice(0, 8)}</strong> {placed.side}{" "}
          {formatMinorCompact(placed.amountMinor)} {placed.tenorLabel} at{" "}
          {formatBps(placed.yieldBps)}
        </div>
      )}
      {requote && (
        <div className="banner banner-warn" role="alert">
          <strong>Re-quoted — nothing was placed.</strong> The {selected.label} yield moved from{" "}
          {formatBps(requote.fromBps)} to {formatBps(requote.toBps)} before your order reached the
          desk. The ticket now shows the current rate.
        </div>
      )}
      {error && (
        <div className="banner banner-error" role="alert">{error}</div>
      )}

      {snapshot ? (
        <>
          {snapshot.unusuallyLarge && (
            <div className="banner banner-warn" role="alert">
              <strong>Larger than usual.</strong> This is well above your typical ticket size.
            </div>
          )}
          <p className="confirm-sentence">{snapshot.sentence}</p>
          {snapshot.heldAtTenorMinor > 0 && (
            <p className="confirm-note">
              This takes your {snapshot.tenorLabel} position to{" "}
              {formatMinor(
                snapshot.side === "SELL"
                  ? snapshot.heldAtTenorMinor - snapshot.amountMinor
                  : snapshot.heldAtTenorMinor + snapshot.amountMinor,
              )}.
            </p>
          )}
          <dl className="summary">
            <div className="summary-row">
              <dt>Annual income</dt>
              <dd>{formatMinor(snapshot.annualIncomeMinor)}</dd>
            </div>
            <div className="summary-row">
              <dt>Settles</dt>
              <dd>{formatDate(snapshot.settlementDate)}</dd>
            </div>
            <div className="summary-row">
              <dt>Matures</dt>
              <dd>{formatDate(snapshot.maturityDate)}</dd>
            </div>
          </dl>
          <div className="confirm-actions">
            <button
              className="submit"
              type="button"
              disabled={submitting}
              onClick={() => void place(snapshot)}
            >
              {submitting ? "Placing…" : "Place order"}
            </button>
            <button className="secondary" type="button" onClick={() => setSnapshot(null)}>
              Back
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (amountReady && shown) setSnapshot(buildSnapshot(shown));
          }}
          noValidate
        >
          <div className="field">
            <span className="field-label" id="side-label">Direction</span>
            <div className="segmented full" role="group" aria-labelledby="side-label">
              {(["BUY", "SELL"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={side === option}
                  onClick={() => {
                    setSide(option);
                    setPlaced(null);
                  }}
                >
                  {option === "BUY" ? "Buy" : "Sell"}
                </button>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="field-label">Term</span>
            <select
              value={selected.key}
              onChange={(event) => {
                onTenorChange(event.target.value);
                setPlaced(null);
              }}
            >
              {curve.points.map((point) => (
                <option key={point.key} value={point.key}>
                  {point.label} — {formatBps(point.yieldBps)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Amount (USD)</span>
            <input
              inputMode="numeric"
              value={amountText}
              aria-invalid={amountText.length > 0 && !amountReady}
              onChange={(event) => {
                const digits = event.target.value.replace(/[^\d]/g, "");
                setAmountText(digits ? Number(digits).toLocaleString("en-US") : "");
                setPlaced(null);
              }}
            />
            {/* Spelled out, because $250,000,000 and $25,000,000 look alike. */}
            <span className="amount-words">
              {amountText ? amountToWords(units) : " "}
            </span>
            {!amountValid && amountText !== "" && (
              <span className="field-error" role="alert">
                Enter a positive dollar amount.
              </span>
            )}
            {exceedsPosition && (
              <span className="field-error" role="alert">
                {shown!.heldAtTenorMinor === 0
                  ? `No position in ${selected.label} to sell.`
                  : `Exceeds your ${selected.label} position of ${formatMinor(shown!.heldAtTenorMinor)}.`}
              </span>
            )}
          </label>

          {sizing?.unusuallyLarge && sizing.medianMinor !== null && (
            <div className="banner banner-warn" role="status">
              <strong>Larger than usual.</strong> This is well above your typical ticket of{" "}
              {formatMinorCompact(sizing.medianMinor)}. Check the amount before continuing.
            </div>
          )}

          <dl className="summary">
            <div className="summary-row summary-lead">
              <dt>Yield</dt>
              <dd>{formatBps(yieldBps)}</dd>
            </div>
            <div className="summary-row">
              <dt>Annual income</dt>
              <dd>{shown ? formatMinor(shown.annualIncomeMinor) : "—"}</dd>
            </div>
            <div className="summary-row">
              <dt>Already held at {selected.label}</dt>
              <dd>{shown ? formatMinor(shown.heldAtTenorMinor) : "—"}</dd>
            </div>
            <div className="summary-row">
              <dt>Settles</dt>
              <dd>{shown ? formatDate(shown.settlementDate) : "—"}</dd>
            </div>
            <div className="summary-row">
              <dt>Matures</dt>
              <dd>{shown ? formatDate(shown.maturityDate) : "—"}</dd>
            </div>
          </dl>

          {shown && (
            <p className="cutoff-note">
              {shown.bookingReason === "market-closed" ? (
                <>
                  The market is closed today, so this books on{" "}
                  {formatDate(shown.bookingDate)} and settles{" "}
                  {formatDate(shown.settlementDate)}.
                </>
              ) : shown.bookingReason === "after-cutoff" ? (
                <>
                  Past today's {shown.cutoffLabel} cutoff, so this books on{" "}
                  {formatDate(shown.bookingDate)} and settles{" "}
                  {formatDate(shown.settlementDate)}.
                </>
              ) : (
                <>
                  Placed before today's {shown.cutoffLabel} cutoff, so this settles{" "}
                  {formatDate(shown.settlementDate)}. After the cutoff it would settle a day later.
                </>
              )}
              {shown.skippedHolidays.length > 0 && (
                <>
                  {" "}
                  {shown.skippedHolidays
                    .map((h) => `${formatDateShort(h.date)} is ${h.name}`)
                    .join("; ")}
                  .
                </>
              )}
            </p>
          )}

          <button className="submit" type="submit" disabled={!amountReady || !shown}>
            {amountReady && !shown ? "Pricing…" : "Review order"}
          </button>
        </form>
      )}
    </section>
  );
}
