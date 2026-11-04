"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronLeft } from "lucide-react";
import { rangeOptions, sliceSeries, type NetWorthPoint, type RangeKey } from "@/lib/history";
import { parseIso } from "@/lib/date";

const HEIGHT = 260;
const PADDING = { top: 16, right: 12, bottom: 28, left: 68 };

const exact = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const rounded = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
/** Smallest decimal count that represents the step exactly in the given unit. */
const unitDecimals = (step: number, unit: number) => {
  const value = Math.abs(step) / unit;
  for (let decimals = 0; decimals <= 3; decimals += 1) if (Math.abs(Number(value.toFixed(decimals)) - value) < value * 1e-6) return decimals;
  return 4;
};

/** One unit for the whole axis, with precision driven by the tick step so labels never collapse. */
function axisFormatter(ticks: number[], step: number) {
  const peak = ticks.reduce((max, tick) => Math.max(max, Math.abs(tick)), 0);
  const unit = peak >= 1_000_000 ? 1_000_000 : peak >= 1_000 ? 1_000 : 1;
  const decimals = unit === 1 ? 0 : unitDecimals(step, unit);
  if (decimals > 2) return rounded;
  const suffix = unit === 1_000_000 ? "M" : unit === 1_000 ? "K" : "";
  return (value: number) => Math.abs(value) < 0.5 ? "$0" : `${value < 0 ? "-" : ""}$${(Math.abs(value) / unit).toFixed(decimals)}${suffix}`;
}
const shortDate = (date: string) => parseIso(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const monthYear = (date: string) => parseIso(date).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const longDate = (date: string) => parseIso(date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function niceTicks(min: number, max: number, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return { ticks: [min], step: 1 };
  const rawStep = (max - min) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)));
  const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(candidate => candidate >= rawStep) ?? magnitude * 10;
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step / 2; value += step) ticks.push(value);
  return { ticks: ticks.length ? ticks : [min, max], step };
}

export default function NetWorthChart({ series, range, onRangeChange, label = "net worth", onBack }: { series: NetWorthPoint[]; range: RangeKey; onRangeChange: (range: RangeKey) => void; label?: string; onBack?: () => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(880);
  const observerRef = useRef<ResizeObserver | null>(null);

  /**
   * A callback ref rather than an effect: with too little history the chart renders
   * an empty state that has no plot element, so a mount-only effect would find no
   * node and never observe the real chart once data arrives, leaving the axis laid
   * out for the default width.
   */
  const measureRef = useCallback((element: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!element) return;
    const apply = (measured: number) => { if (measured > 0) setWidth(Math.max(320, measured)); };
    apply(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(entries => apply(entries[0]?.contentRect.width ?? 0));
    observer.observe(element);
    observerRef.current = observer;
  }, []);

  const points = useMemo(() => sliceSeries(series, range), [series, range]);
  const geometry = useMemo(() => {
    if (points.length < 2) return null;
    const values = points.map(point => point.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const pad = (rawMax - rawMin || Math.abs(rawMax) || 1) * 0.12;
    const min = rawMin - pad;
    const max = rawMax + pad;
    const plotWidth = Math.max(1, width - PADDING.left - PADDING.right);
    const plotHeight = HEIGHT - PADDING.top - PADDING.bottom;
    const x = (index: number) => PADDING.left + (index / (points.length - 1)) * plotWidth;
    const y = (value: number) => PADDING.top + (1 - (value - min) / (max - min || 1)) * plotHeight;
    const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.value).toFixed(2)}`).join(" ");
    const area = `${line} L${x(points.length - 1).toFixed(2)},${(HEIGHT - PADDING.bottom).toFixed(2)} L${x(0).toFixed(2)},${(HEIGHT - PADDING.bottom).toFixed(2)} Z`;
    const scale = niceTicks(rawMin - pad / 2, rawMax + pad / 2);
    return { x, y, line, area, plotWidth, ticks: scale.ticks, tickLabel: axisFormatter(scale.ticks, scale.step) };
  }, [points, width]);

  const backLink = onBack ? <button onClick={onBack} className="mb-3 flex items-center gap-1 text-sm font-medium text-[#3b7fbd]"><ChevronLeft size={15} /> Back to net worth</button> : null;

  if (points.length < 2 || !geometry) {
    return <section className="card p-6">{backLink}<h2 className="font-semibold">{label === "net worth" ? "Net worth history" : `${label} history`}</h2><p className="mt-2 text-sm text-[#718096]">Import or save at least two dated balances to chart this history over time.</p></section>;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const activeIndex = hover === null ? points.length - 1 : Math.min(points.length - 1, Math.max(0, hover));
  const active = points[activeIndex];
  const change = active.value - first.value;
  const changePct = first.value === 0 ? 0 : (change / Math.abs(first.value)) * 100;
  const positive = change >= 0;
  const activeX = geometry.x(activeIndex);
  const tooltipLeft = Math.min(Math.max(activeX, 150), Math.max(150, width - 150));
  const labelIndexes = [...new Set([0, Math.round((points.length - 1) * 0.25), Math.round((points.length - 1) * 0.5), Math.round((points.length - 1) * 0.75), points.length - 1])];
  const spansYears = parseIso(last.date).getTime() - parseIso(first.date).getTime() > 400 * 86_400_000;
  const axisDate = spansYears ? monthYear : shortDate;

  function locate(event: React.MouseEvent<SVGSVGElement>) {
    if (!geometry) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    // The viewBox can scale the drawing, so map the pointer back into user units.
    const scale = bounds.width > 0 ? width / bounds.width : 1;
    const ratio = ((event.clientX - bounds.left) * scale - PADDING.left) / geometry.plotWidth;
    setHover(Math.round(Math.min(1, Math.max(0, ratio)) * (points.length - 1)));
  }

  return <section className="card p-6">
    {backLink}
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-2xl font-bold tracking-tight">{rounded(last.value)}</h2>
          <span className="text-sm text-[#718096]">{label}</span>
          <span className={`flex items-center gap-1 text-sm font-semibold ${positive ? "text-[#2f9e6e]" : "text-[#b95d57]"}`}>
            {positive ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
            {exact(Math.abs(change))} ({Math.abs(changePct).toFixed(1)}%)
          </span>
        </div>
        <p className="mt-1 text-xs text-[#718096]">{longDate(first.date)} – {longDate(last.date)}</p>
      </div>
      <label className="text-sm">
        <span className="sr-only">History range</span>
        <select aria-label="History range" value={range} onChange={event => { onRangeChange(event.target.value as RangeKey); setHover(null); }} className="rounded-lg border border-[#dfe5e9] bg-white px-3 py-2">
          {rangeOptions.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>
    </div>

    <div ref={measureRef} className="relative">
      {hover !== null && <div className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-xl bg-[#17212b] px-4 py-3 text-white shadow-lg" style={{ left: tooltipLeft, top: 0 }}>
        <div className="whitespace-nowrap text-xs font-semibold">{longDate(first.date)} – {longDate(active.date)}</div>
        <div className="mt-1 flex items-baseline gap-3 whitespace-nowrap">
          <span className="text-base font-bold">{exact(active.value)}</span>
          <span className={`text-xs font-semibold ${positive ? "text-[#8ee0b8]" : "text-[#f0a9a2]"}`}>{positive ? "+" : "-"}{exact(Math.abs(change))} ({Math.abs(changePct).toFixed(2)}%)</span>
        </div>
      </div>}

      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} preserveAspectRatio="xMidYMid meet" className="block max-w-full" role="img" aria-label={`${label} history`} onMouseMove={locate} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38b6d9" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#38b6d9" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {geometry.ticks.map(tick => <g key={tick}>
          <line x1={PADDING.left} x2={width - PADDING.right} y1={geometry.y(tick)} y2={geometry.y(tick)} stroke="#eef1f4" />
          <text x={PADDING.left - 10} y={geometry.y(tick) + 4} textAnchor="end" fill="#718096" fontSize={10}>{geometry.tickLabel(tick)}</text>
        </g>)}

        <path d={geometry.area} fill="url(#netWorthFill)" />
        <path d={geometry.line} fill="none" stroke="#1d9bc4" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {labelIndexes.map(index => <text key={index} x={geometry.x(index)} y={HEIGHT - 8} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} fill="#718096" fontSize={10}>{axisDate(points[index].date)}</text>)}

        {hover !== null && <g>
          <line x1={activeX} x2={activeX} y1={PADDING.top} y2={HEIGHT - PADDING.bottom} stroke="#b6c2cc" strokeDasharray="4 4" />
          <circle cx={activeX} cy={geometry.y(active.value)} r={5} fill="#ffffff" stroke="#1d9bc4" strokeWidth={3} />
        </g>}
      </svg>
    </div>
  </section>;
}
