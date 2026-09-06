import type { HoldingsResponse } from "../types";
import { formatDate, formatBps, formatBpsDelta, formatMinor } from "../lib/format";

interface Props {
  holdings: HoldingsResponse | null;
  loading: boolean;
}

function deltaClass(bps: number | null): string {
  if (bps === null || bps === 0) return "muted";
  return bps > 0 ? "delta-up" : "delta-down";
}

export function HoldingsTable({ holdings, loading }: Props) {
  if (loading) {
    return (
      <section className="card" id="portfolio" aria-labelledby="holdings-heading">
        <div className="card-head">
          <h2 id="holdings-heading">Portfolio performance</h2>
          <span className="hint">Mark-to-market on open positions</span>
        </div>
        <p className="empty">Loading…</p>
      </section>
    );
  }

  if (!holdings || holdings.holdings.length === 0) {
    return (
      <section className="card" id="portfolio" aria-labelledby="holdings-heading">
        <div className="card-head">
          <h2 id="holdings-heading">Portfolio performance</h2>
          <span className="hint">Mark-to-market on open positions</span>
        </div>
        <p className="empty">No open positions.</p>
      </section>
    );
  }

  return (
    <section className="card" id="portfolio" aria-labelledby="holdings-heading">
      <div className="card-head">
        <h2 id="holdings-heading">Portfolio performance</h2>
        <span className="hint">Mark-to-market on open positions</span>
      </div>

      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">Holdings and performance</caption>
          <thead>
            <tr>
              <th scope="col">Purchased</th>
              <th scope="col">Term</th>
              <th scope="col" className="num">Notional</th>
              <th scope="col" className="num">Bought at</th>
              <th scope="col" className="num">Current</th>
              <th scope="col" className="num">Change</th>
              <th scope="col" className="num">Days Held</th>
              <th scope="col" className="num">Accrued</th>
              <th scope="col" className="num">Unrealized</th>
              <th scope="col" className="num">Total Return</th>
            </tr>
          </thead>
          <tbody>
            {holdings.holdings.map((holding) => (
              <tr key={holding.orderId}>
                <td>{formatDate(holding.purchaseDate)}</td>
                <td>{holding.tenorLabel}</td>
                <td className="num">{formatMinor(holding.notionalMinor)}</td>
                <td className="num">{formatBps(holding.purchaseYieldBps)}</td>
                <td className="num">
                  {holding.currentYieldBps !== null
                    ? formatBps(holding.currentYieldBps)
                    : "–"}
                </td>
                <td className={`num ${deltaClass(holding.currentYieldBps !== null ? holding.currentYieldBps - holding.purchaseYieldBps : null)}`}>
                  {holding.currentYieldBps !== null
                    ? formatBpsDelta(holding.currentYieldBps - holding.purchaseYieldBps)
                    : "–"}
                </td>
                <td className="num">{holding.daysHeld}</td>
                <td className="num">{formatMinor(holding.accruedInterestMinor)}</td>
                <td className={`num ${deltaClass(holding.unrealizedPnlMinor)}`}>
                  {formatMinor(holding.unrealizedPnlMinor)}
                </td>
                <td className={`num ${deltaClass(holding.totalReturnMinor)}`}>
                  {formatMinor(holding.totalReturnMinor)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ textAlign: "right", fontWeight: "bold" }}>
                Total:
              </td>
              <td className="num" style={{ fontWeight: "bold" }}>
                {formatMinor(holdings.totalNotionalMinor)}
              </td>
              <td colSpan={4}></td>
              <td className="num" style={{ fontWeight: "bold" }}>
                {formatMinor(holdings.totalAccruedMinor)}
              </td>
              <td className={`num ${deltaClass(holdings.totalUnrealizedPnlMinor)}`} style={{ fontWeight: "bold" }}>
                {formatMinor(holdings.totalUnrealizedPnlMinor)}
              </td>
              <td className={`num ${deltaClass(holdings.totalReturnMinor)}`} style={{ fontWeight: "bold" }}>
                {formatMinor(holdings.totalReturnMinor)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
