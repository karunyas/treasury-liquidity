import type { LadderResponse } from "../types";
import { formatMinor, formatMinorCompact } from "../lib/format";

interface MaturityLadderProps {
  ladder: LadderResponse | null;
  loading: boolean;
  /** Key of the bucket currently used as a filter (renders as "active"). */
  activeBucket?: string | null;
  /** Called when the pointer enters/leaves a bucket row. null = pointer left. */
  onHoverBucket?: (key: string | null) => void;
  /** Called when a bucket row is clicked (toggle filter). */
  onClickBucket?: (key: string) => void;
}

const formatMaturity = (months: number): string => {
  if (months >= 12) {
    const years = (months / 12).toFixed(1);
    return `${years} yr`;
  }
  return `${Math.round(months)} mo`;
};

export function MaturityLadder({
  ladder,
  loading,
  activeBucket,
  onHoverBucket,
  onClickBucket,
}: MaturityLadderProps) {
  if (loading && !ladder) {
    return (
      <section className="card" aria-labelledby="ladder-heading">
        <div className="card-head">
          <div className="card-heading">
            <h2 id="ladder-heading">Cash returning</h2>
            <p className="card-hint">When your open orders mature</p>
          </div>
        </div>
        <p className="empty">Loading…</p>
      </section>
    );
  }

  if (!ladder) return null;

  const { buckets, totalMinor, weightedAverageMonths } = ladder;

  if (totalMinor === 0) {
    return (
      <section className="card" aria-labelledby="ladder-heading">
        <div className="card-head">
          <div className="card-heading">
            <h2 id="ladder-heading">Cash returning</h2>
            <p className="card-hint">When your open orders mature</p>
          </div>
        </div>
        <p className="empty">No open orders yet. Place one and it will show up here.</p>
      </section>
    );
  }

  const maxNotional = Math.max(...buckets.map((b) => b.notionalMinor), 1);
  const interactive = !!(onHoverBucket || onClickBucket);

  return (
    <section className="card" aria-labelledby="ladder-heading">
      <div className="card-head">
        <div className="card-heading">
          <h2 id="ladder-heading">Cash returning</h2>
          <p className="card-hint">When your open orders mature</p>
        </div>
      </div>

      <div
        className="ladder-body"
        onMouseLeave={onHoverBucket ? () => onHoverBucket(null) : undefined}
      >
        {buckets.map((bucket) => {
          const barWidth = (bucket.notionalMinor / maxNotional) * 100;
          const isZero = bucket.notionalMinor === 0;
          const isActive = activeBucket === bucket.key;

          return (
            <div
              key={bucket.key}
              className={[
                "ladder-row",
                interactive && !isZero ? "ladder-row-interactive" : "",
                isActive ? "ladder-row-active" : "",
              ].join(" ").trim()}
              onMouseEnter={
                onHoverBucket && !isZero ? () => onHoverBucket(bucket.key) : undefined
              }
              onClick={
                onClickBucket && !isZero ? () => onClickBucket(bucket.key) : undefined
              }
              role={interactive && !isZero ? "button" : undefined}
              tabIndex={interactive && !isZero ? 0 : undefined}
              onKeyDown={
                onClickBucket && !isZero
                  ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClickBucket(bucket.key); } }
                  : undefined
              }
            >
              <div className="ladder-label">{bucket.label}</div>

              <div className="ladder-bar-container" aria-hidden="true">
                {!isZero && (
                  <div
                    className="ladder-bar"
                    style={{ width: `${barWidth}%` }}
                  />
                )}
              </div>

              <div className={`ladder-amount num ${isZero ? "muted" : ""}`}>
                {formatMinorCompact(bucket.notionalMinor)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="ladder-footer">
        <span className="ladder-total num">{formatMinor(totalMinor)}</span>
        <span className="ladder-separator">·</span>
        <span className="ladder-maturity">{formatMaturity(weightedAverageMonths)} average</span>
      </div>
    </section>
  );
}
