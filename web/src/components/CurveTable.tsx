import { useEffect, useRef } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CurveResponse } from "../types";
import { useChartPalette } from "../lib/theme";
import { formatBps, formatBpsDelta, formatDateShort } from "../lib/format";

interface Props {
  data: CurveResponse;
  selectedTenor: string;
  onSelectTenor: (key: string) => void;
  /** Frozen while an order is being confirmed, so it cannot rewrite the trade. */
  locked?: boolean;
}

/**
 * The table is the interface; the chart is a shape check.
 *
 * A liquidity manager is picking a term, not exploring a dataset, so the
 * numbers get the space and the curve gets a sparkline.
 */
export function CurveTable({ data, selectedTenor, onSelectTenor, locked = false }: Props) {
  const palette = useChartPalette();
  const priorWeek = new Map(data.priorWeek?.points.map((p) => [p.key, p.yieldBps]) ?? []);

  const sparkData = data.points.map((point) => ({
    key: point.key,
    label: point.label,
    today: point.yieldBps / 100,
    priorWeek: priorWeek.has(point.key) ? priorWeek.get(point.key)! / 100 : null,
  }));

  // Track row elements for roving tabindex focus management
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const shouldFocusRef = useRef<boolean>(false);

  // Focus the selected row after arrow-key navigation, but not on every render
  useEffect(() => {
    if (shouldFocusRef.current && rowRefs.current.has(selectedTenor)) {
      rowRefs.current.get(selectedTenor)?.focus();
      shouldFocusRef.current = false;
    }
  }, [selectedTenor]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>, currentKey: string) => {
    if (locked) return;

    const currentIndex = data.points.findIndex((p) => p.key === currentKey);
    let newIndex = currentIndex;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectTenor(currentKey);
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      newIndex = Math.min(currentIndex + 1, data.points.length - 1);
      if (newIndex !== currentIndex) {
        shouldFocusRef.current = true;
        onSelectTenor(data.points[newIndex]!.key);
      }
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      newIndex = Math.max(currentIndex - 1, 0);
      if (newIndex !== currentIndex) {
        shouldFocusRef.current = true;
        onSelectTenor(data.points[newIndex]!.key);
      }
    } else if (event.key === "Home") {
      event.preventDefault();
      if (currentIndex !== 0) {
        shouldFocusRef.current = true;
        onSelectTenor(data.points[0]!.key);
      }
    } else if (event.key === "End") {
      event.preventDefault();
      newIndex = data.points.length - 1;
      if (currentIndex !== newIndex) {
        shouldFocusRef.current = true;
        onSelectTenor(data.points[newIndex]!.key);
      }
    }
  };

  return (
    <section className="card" aria-labelledby="curve-heading">
      <div className="card-head">
        {/* The hint instructs you about the table, so it sits directly above
            it rather than right-aligned across the card from the chart. */}
        <div className="card-heading">
          <h2 id="curve-heading">Par yield curve</h2>
          <p className={locked ? "card-hint card-hint-active" : "card-hint"}>
            {locked
              ? "Locked while you confirm the order"
              : "Select a term to load it into the ticket"}
          </p>
        </div>
      </div>

      {/* Table and chart sit side by side: the chart then gets real width
         and the table's full height, instead of a 96px strip beneath it. */}
      <div className="curve-body">
      <div className={locked ? "table-scroll is-locked" : "table-scroll"}>
        <table className="curve-table" aria-disabled={locked || undefined}>
          <caption className="visually-hidden">
            Treasury par yields by term, with the move since the previous curve and since last week
          </caption>
          <thead>
            <tr>
              <th scope="col">Term</th>
              <th scope="col" className="num">Yield</th>
              <th scope="col" className="num">1D bps</th>
              <th scope="col" className="num">1W bps</th>
            </tr>
          </thead>
          <tbody role="radiogroup" aria-label="Select a term">
            {data.points.map((point) => {
              const selected = point.key === selectedTenor;
              return (
                <tr
                  key={point.key}
                  ref={(el) => {
                    if (el) rowRefs.current.set(point.key, el);
                    else rowRefs.current.delete(point.key);
                  }}
                  className={selected ? "row-selected" : undefined}
                  aria-checked={selected}
                  tabIndex={locked ? -1 : selected ? 0 : -1}
                  role="radio"
                  onClick={locked ? undefined : () => onSelectTenor(point.key)}
                  onKeyDown={(event) => handleKeyDown(event, point.key)}
                >
                  <th scope="row">{point.label}</th>
                  <td className="num strong">{formatBps(point.yieldBps)}</td>
                  <td className={`num ${deltaClass(point.changeDayBps)}`}>
                    {formatBpsDelta(point.changeDayBps)}
                  </td>
                  <td className={`num ${deltaClass(point.changeWeekBps)}`}>
                    {formatBpsDelta(point.changeWeekBps)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

        <div className="curve-chart">
      <div className="spark-head">
        <span className="legend-item">
          <svg width="20" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="20" y2="4" stroke={palette.series1} strokeWidth="2" />
          </svg>
          Today
        </span>
        {data.priorWeek && (
          <span className="legend-item">
            <svg width="20" height="8" aria-hidden="true">
              <line
                x1="0" y1="4" x2="20" y2="4"
                stroke={palette.series2} strokeWidth="2" strokeDasharray="4 3"
              />
            </svg>
            {formatDateShort(data.priorWeek.asOfDate)}
          </span>
        )}
      </div>

      <div className="spark-wrap" role="img" aria-label="Curve shape, today versus last week">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={sparkData}
            margin={{ top: 6, right: 10, bottom: 0, left: 0 }}
            onClick={(state: { activePayload?: Array<{ payload?: { key: string } }> }) => {
              if (locked) return;
              const key = state?.activePayload?.[0]?.payload?.key;
              if (key) onSelectTenor(key);
            }}
            style={{ cursor: locked ? "default" : "pointer" }}
          >
            <CartesianGrid vertical={false} stroke={palette.grid} strokeWidth={1} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: palette.axis }}
              tick={{ fill: palette.muted, fontSize: 10 }}
              interval="preserveStartEnd"
              minTickGap={12}
            />
            <YAxis
              domain={["dataMin - 0.1", "dataMax + 0.1"]}
              tickLine={false}
              axisLine={false}
              width={44}
              tick={{ fill: palette.muted, fontSize: 10 }}
              tickFormatter={(v: number) => `${v.toFixed(2)}%`}
            />
            <Tooltip
              cursor={{ stroke: palette.axis, strokeWidth: 1 }}
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as (typeof sparkData)[number] | undefined;
                if (!active || !row) return null;
                return (
                  <div className="tooltip">
                    <div className="tooltip-head">{row.label}</div>
                    <div className="tooltip-row">
                      <span>Today</span>
                      <span>{row.today.toFixed(2)}%</span>
                    </div>
                    {row.priorWeek !== null && (
                      <div className="tooltip-row">
                        <span>Last week</span>
                        <span>{row.priorWeek.toFixed(2)}%</span>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {data.priorWeek && (
              <Line
                type="monotone" dataKey="priorWeek" stroke={palette.series2} strokeWidth={2}
                strokeDasharray="4 3"
                dot={(dotProps: { cx?: number; cy?: number; payload?: { key: string; priorWeek: number | null } }) => {
                  const isSelected = dotProps.payload?.key === selectedTenor && dotProps.payload?.priorWeek !== null;
                  const key = dotProps.payload?.key;
                  return (
                    <g
                      key={`prior-dot-${key}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!locked && key) onSelectTenor(key);
                      }}
                      style={{ cursor: locked ? "default" : "pointer" }}
                    >
                      {/* Invisible larger hit target: the visible dot is r=0 except when selected. */}
                      <circle cx={dotProps.cx} cy={dotProps.cy} r={10} fill="transparent" />
                      <circle
                        cx={dotProps.cx}
                        cy={dotProps.cy}
                        r={isSelected ? 4 : 0}
                        fill={palette.series2}
                        stroke={palette.surface}
                        strokeWidth={2}
                      />
                    </g>
                  );
                }}
                connectNulls isAnimationActive={false}
              />
            )}
            <Line
              type="monotone" dataKey="today" stroke={palette.series1} strokeWidth={2}
              dot={(dotProps: { cx?: number; cy?: number; payload?: { key: string } }) => {
                const isSelected = dotProps.payload?.key === selectedTenor;
                const key = dotProps.payload?.key;
                return (
                  <g
                    key={`today-dot-${key}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!locked && key) onSelectTenor(key);
                    }}
                    style={{ cursor: locked ? "default" : "pointer" }}
                  >
                    {/* Invisible larger hit target: the visible dot is r=0 except when selected. */}
                    <circle cx={dotProps.cx} cy={dotProps.cy} r={10} fill="transparent" />
                    <circle
                      cx={dotProps.cx}
                      cy={dotProps.cy}
                      r={isSelected ? 5 : 0}
                      fill={palette.series1}
                      stroke={palette.surface}
                      strokeWidth={2}
                    />
                  </g>
                );
              }}
              isAnimationActive={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: palette.surface }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
        </div>
      </div>
    </section>
  );
}

/** Direction is also carried by the sign, so colour is never the only cue. */
function deltaClass(bps: number | null): string {
  if (bps === null || bps === 0) return "muted";
  return bps > 0 ? "delta-up" : "delta-down";
}
