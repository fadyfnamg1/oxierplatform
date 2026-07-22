import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore } from '../lib/store';
import {
  TIMEFRAMES, fetchBinanceKlines, genSimData, genShortTFData, SHORT_TFS,
  calcRSI, calcMACD, calcBB, calcEMA, calcSMA,
  calcCCI, calcATR, calcStoch, calcWilliams, calcVolume,
  calcVWAP, calcWMA, calcDonchian, calcADX, calcMomentum, calcMFI,
} from '../lib/markets';
import type { TF } from '../lib/markets';

// All timeframes in display order
const TFS: TF[] = ['5s','10s','30s','1m','3m','5m','15m','30m','1h','2h','4h'];
const CHART_TYPES = ['Candles', 'HeikinAshi', 'Bars', 'Line', 'Area'] as const;
type ChartType = typeof CHART_TYPES[number];

// ── Chart-type SVG icon definitions ───────────────────────────────────────────
const CHART_TYPE_ICONS: Record<string, JSX.Element> = {
  Candles: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <line x1="5" y1="2" x2="5" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <rect x="3" y="5" width="4" height="7" rx="1" fill="var(--g0)" stroke="var(--g0)" strokeWidth="1"/>
      <line x1="5" y1="12" x2="5" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="13" y1="6" x2="13" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <rect x="11" y="9" width="4" height="8" rx="1" fill="var(--red)" stroke="var(--red)" strokeWidth="1"/>
      <line x1="13" y1="17" x2="13" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="19" y1="3" x2="19" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <rect x="17" y="7" width="4" height="6" rx="1" fill="var(--g0)" stroke="var(--g0)" strokeWidth="1"/>
      <line x1="19" y1="13" x2="19" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  HeikinAshi: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <line x1="5" y1="2" x2="5" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <rect x="3" y="5" width="4" height="9" rx="1" fill="var(--g0)" stroke="var(--g0)" strokeWidth="1"/>
      <line x1="5" y1="14" x2="5" y2="16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="13" y1="5" x2="13" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <rect x="11" y="8" width="4" height="10" rx="1" fill="var(--red)" stroke="var(--red)" strokeWidth="1"/>
      <line x1="13" y1="18" x2="13" y2="21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="19" y1="3" x2="19" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <rect x="17" y="6" width="4" height="8" rx="1" fill="var(--g0)" stroke="var(--g0)" strokeWidth="1"/>
      <line x1="19" y1="14" x2="19" y2="17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      <text x="7" y="24" fontSize="5" fill="currentColor" opacity=".5">HA</text>
    </svg>
  ),
  Bars: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="5" y1="4" x2="5" y2="16"/>
      <line x1="3" y1="8" x2="5" y2="8"/>
      <line x1="5" y1="12" x2="7" y2="12"/>
      <line x1="13" y1="7" x2="13" y2="20"/>
      <line x1="11" y1="11" x2="13" y2="11"/>
      <line x1="13" y1="16" x2="15" y2="16"/>
      <line x1="19" y1="3" x2="19" y2="15"/>
      <line x1="17" y1="7" x2="19" y2="7"/>
      <line x1="19" y1="11" x2="21" y2="11"/>
    </svg>
  ),
  Line: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--g0)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="2 18 8 10 13 14 22 5"/>
    </svg>
  ),
  Area: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <polyline points="2 16 7 9 12 13 18 6 22 9" stroke="var(--g0)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 16 L7 9 L12 13 L18 6 L22 9 L22 20 L2 20 Z" fill="rgba(0,214,143,.12)"/>
    </svg>
  ),
};

declare const LightweightCharts: any;

function loadLWC(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof LightweightCharts !== 'undefined') { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js';
    s.onload = () => resolve();
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ─── Drawing types ────────────────────────────────────────────────────────────
type DrawTool = 'trendline'|'hline'|'ray'|'hray'|'rectangle'|'ellipse'|'fibonacci'|'fibext'|'fibfan'|'fibchannel'|'daterange'|'channel'|'vline'|'arrow'|'triangle'|'pitchfork';

// Store drawings in TIME coordinates (unix timestamp) so they stay anchored
// to the correct candle across timeframe changes and resizes.
interface DataPoint { time: number; price: number; }
interface Drawing {
  id: string;
  tool: DrawTool;
  p1: DataPoint;
  p2: DataPoint;
  p3?: DataPoint;
  color: string;
  width: number;
  style: 'solid'|'dashed'|'dotted';
  finished: boolean;
}

const DEFAULT_COLORS = [
  '#F59E0B','#60A5FA','#A78BFA','#34D399','#F472B6',
  '#22D3EE','#ef4444','#ffffff','#fb923c','#86efac',
];

const TOOL_COLORS: Record<DrawTool, string> = {
  trendline: '#F59E0B', hline: '#60A5FA', ray: '#A78BFA', hray: '#C084FC',
  rectangle: '#34D399', ellipse: '#2DD4BF', fibonacci: '#F472B6', fibext: '#F0ABFC',
  fibfan: '#FDE047', fibchannel: '#4ADE80', daterange: '#38BDF8',
  channel: '#22D3EE', vline: '#FB923C', arrow: '#FBBF24', triangle: '#86efac', pitchfork: '#f97316',
};

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899'];
const FIB_EXT_LEVELS = [0, 0.618, 1, 1.272, 1.618, 2, 2.618];
const FIB_EXT_COLORS = ['#94a3b8','#22c55e','#eab308','#3b82f6','#8b5cf6','#ec4899','#ef4444'];

// ─── Tool groups ──────────────────────────────────────────────────────────────
interface Tool { id: DrawTool | null; label: string; icon: string; }

const TOOL_GROUPS: { label: string; tools: Tool[] }[] = [
  {
    label: 'Lines',
    tools: [
      { id: null,        label: 'Cursor',     icon: '↖' },
      { id: 'trendline', label: 'Trend Line', icon: '↗' },
      { id: 'ray',       label: 'Ray',        icon: '→' },
      { id: 'hray',      label: 'H-Ray',      icon: '⇥' },
      { id: 'hline',     label: 'H-Line',     icon: '—' },
      { id: 'vline',     label: 'V-Line',     icon: '|' },
      { id: 'arrow',     label: 'Arrow',      icon: '⇗' },
    ],
  },
  {
    label: 'Shapes',
    tools: [
      { id: 'rectangle', label: 'Rectangle', icon: '▭' },
      { id: 'ellipse',   label: 'Ellipse',   icon: '◯' },
      { id: 'triangle',  label: 'Triangle',  icon: '△' },
      { id: 'channel',   label: 'Channel',   icon: '≡' },
    ],
  },
  {
    label: 'Patterns',
    tools: [
      { id: 'fibonacci',   label: 'Fibonacci',        icon: 'ϕ' },
      { id: 'fibext',      label: 'Fib Extension',    icon: 'Ϝ' },
      { id: 'fibfan',      label: 'Fib Fan',          icon: 'Λ' },
      { id: 'fibchannel',  label: 'Fib Channel',      icon: '≣' },
      { id: 'daterange',   label: 'Date Range',       icon: '↔' },
      { id: 'pitchfork',   label: 'Pitchfork',        icon: '⑃' },
    ],
  },
];

// ─── Future "whitespace" padding ──────────────────────────────────────────────
// lightweight-charts only knows how to map a pixel to a time for coordinates
// that fall on (or between) actual data points. Without this, dragging a
// drawing past the last candle has nowhere to land and it snaps back to the
// last candle. Appending whitespace points (time only, no OHLC) — a feature
// built into lightweight-charts specifically for this — gives the time axis
// real coordinates to extend into, so drawings (Fibonacci, trend lines, etc.)
// can be projected into the future the way traders normally use them.
const FUTURE_WHITESPACE_BARS = 150;
function withFutureWhitespace<T extends { time: number }>(data: T[], intervalSec: number, count = FUTURE_WHITESPACE_BARS): T[] {
  if (!data.length || !intervalSec) return data;
  const lastTime = data[data.length - 1].time;
  const extra = Array.from({ length: count }, (_, i) => ({ time: lastTime + (i + 1) * intervalSec })) as T[];
  return [...data, ...extra];
}
// Same idea, but returns ONLY the future points (no real data mixed in) —
// used to feed the separate whitespace helper series.
function futureWhitespaceOnly(lastTime: number, intervalSec: number, count = FUTURE_WHITESPACE_BARS): { time: number }[] {
  if (!intervalSec) return [];
  return Array.from({ length: count }, (_, i) => ({ time: lastTime + (i + 1) * intervalSec }));
}

// ─── Heikin Ashi calculation ──────────────────────────────────────────────────
function calcHeikinAshi(bars: any[]): any[] {
  const ha: any[] = [];
  for (let i = 0; i < bars.length; i++) {
    const haClose = (bars[i].open + bars[i].high + bars[i].low + bars[i].close) / 4;
    const haOpen  = i === 0
      ? (bars[i].open + bars[i].close) / 2
      : (ha[i - 1].open + ha[i - 1].close) / 2;
    const haHigh  = Math.max(bars[i].high, haOpen, haClose);
    const haLow   = Math.min(bars[i].low,  haOpen, haClose);
    ha.push({ time: bars[i].time, open: haOpen, high: haHigh, low: haLow, close: haClose, volume: bars[i].volume });
  }
  return ha;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function TradingChart() {
  const currentMarket     = useStore(s => s.currentMarket);
  const currentTF         = useStore(s => s.currentTF);
  const setCurrentTF      = useStore(s => s.setCurrentTF);
  const activeInds        = useStore(s => s.activeInds);
  const indicatorSettings = useStore(s => s.indicatorSettings);
  const theme             = useStore(s => s.theme);
  const trades            = useStore(s => s.trades);
  const setLivePrice      = useStore(s => s.setLivePrice);

  const containerRef    = useRef<HTMLDivElement>(null);
  const subContainerRef = useRef<HTMLDivElement>(null);
  const chartRef        = useRef<any>(null);
  const subChartRef     = useRef<any>(null);
  const mainSeriesRef   = useRef<any>(null);
  // Invisible helper series holding ONLY the future whitespace points.
  // Kept separate from mainSeriesRef so that mainSeries.update() (used for
  // every live price tick) always sees a real bar as its own last data
  // point — update() requires the new point's time to be >= the series'
  // own last point, and whitespace 150 bars into the future would violate
  // that and make every live update silently fail (candles frozen while
  // the price ticker keeps moving). The time scale still extends into the
  // future because it's the union of every series' data, so drawings can
  // still be projected forward using this series alone.
  const whitespaceSeriesRef = useRef<any>(null);
  const wsRef           = useRef<WebSocket | null>(null);
  const barsRef         = useRef<any[]>([]);
  const priceLinesRef   = useRef<Map<string, any>>(new Map());
  const shortTFTimerRef = useRef<any>(null);
  const wsStaleTimerRef = useRef<any>(null);
  // Bumped every time buildChart() runs. Async work started by an older
  // build (an in-flight fetch, a WebSocket that hasn't opened yet) checks
  // this before touching shared refs/state, so a stale build can never
  // clobber wsRef/barsRef or push a wrong-symbol price into the store
  // after the user has already switched market/timeframe.
  const buildIdRef      = useRef(0);

  const [lwcReady, setLwcReady]       = useState(false);
  const [chartType, setChartType]     = useState<ChartType>('Candles');
  const [hasSubChart, setHasSubChart] = useState(false);
  const [loading, setLoading]         = useState(true);
  const [drawMode, setDrawMode]       = useState<DrawTool | null>(null);
  const [toolsOpen, setToolsOpen]     = useState(false);
  const [drawings, setDrawings]       = useState<Drawing[]>([]);
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [editDraw, setEditDraw]       = useState<Drawing | null>(null);
  const [drawColor, setDrawColor]     = useState('#F59E0B');
  const [drawWidth, setDrawWidth]     = useState(1.5);
  const [drawStyle, setDrawStyle]     = useState<'solid'|'dashed'|'dotted'>('solid');

  // Canvas drawing overlay
  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const drawingsRef    = useRef<Drawing[]>([]);
  const activeDrawRef  = useRef<Drawing | null>(null);
  // Live preview of a drag-in-progress on an EXISTING drawing (see
  // redrawCanvas above). null while nothing is being dragged.
  const dragPreviewRef = useRef<Drawing | null>(null);
  const isDrawingRef   = useRef(false);

  const isDark      = theme === 'dark';
  const bg          = isDark ? '#080C16' : '#FFFFFF';
  const gridColor   = isDark ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.04)';
  const borderColor = isDark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.08)';
  const textColor   = isDark ? 'rgba(240,246,252,.5)' : 'rgba(10,14,26,.5)';

  // Keep drawingsRef in sync
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);
  useEffect(() => { loadLWC().then(() => setLwcReady(true)).catch(() => {}); }, []);

  // ─── Coordinate conversion helpers ────────────────────────────────────────
  // Use TIME (unix timestamp) coordinates for drawings so they stay anchored
  // to the same candle when the user switches timeframe or resizes the chart.
  // Seconds between two consecutive real candles at the current timeframe —
  // used to extrapolate time/pixel positions past the last real bar so
  // drawings can extend into the future instead of stopping dead at the
  // last candle.
  function _barIntervalSec(): number | null {
    const bars = barsRef.current;
    if (!bars || bars.length < 2) return null;
    const iv = bars[bars.length - 1].time - bars[bars.length - 2].time;
    return iv > 0 ? iv : null;
  }

  function pixelToData(x: number, y: number): DataPoint | null {
    if (!chartRef.current || !mainSeriesRef.current) return null;
    try {
      const ts = chartRef.current.timeScale();
      const price = mainSeriesRef.current.coordinateToPrice(y);
      if (price == null) return null;
      let time = ts.coordinateToTime(x) as number | null;
      if (time == null) {
        // Past the last real candle: coordinateToTime only knows about
        // actual data points, so fall back to the geometric logical-index
        // mapping (always defined) and extrapolate a timestamp from it.
        const bars = barsRef.current;
        const iv = _barIntervalSec();
        if (!bars?.length || !iv) return null;
        const logical = ts.coordinateToLogical(x);
        if (logical == null) return null;
        const lastIdx = bars.length - 1;
        time = bars[lastIdx].time + Math.round((logical - lastIdx) * iv);
      }
      return { time: time as number, price };
    } catch { return null; }
  }

  function dataToPixel(dp: DataPoint): { x: number; y: number } | null {
    if (!chartRef.current || !mainSeriesRef.current) return null;
    try {
      const ts = chartRef.current.timeScale();
      const y = mainSeriesRef.current.priceToCoordinate(dp.price);
      if (y == null) return null;
      let x = ts.timeToCoordinate(dp.time);
      if (x == null) {
        // dp.time may be a future timestamp we invented above that has no
        // matching real (or whitespace) bar yet — map it back the same way.
        const bars = barsRef.current;
        const iv = _barIntervalSec();
        if (!bars?.length || !iv) return null;
        const lastIdx = bars.length - 1;
        const logical = lastIdx + (dp.time - bars[lastIdx].time) / iv;
        x = ts.logicalToCoordinate(logical);
        if (x == null) return null;
      }
      return { x, y };
    } catch { return null; }
  }

  // ─── Canvas redraw ────────────────────────────────────────────────────────
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // While an existing drawing is being dragged (endpoint or whole shape),
    // its live in-progress position lives here instead of in React state —
    // same reasoning as activeDrawRef: touching setDrawings on every
    // pointermove would re-render the whole component 60+ times/sec and
    // make the drag feel choppy. The real drawings array is only updated
    // once, when the drag finishes.
    const dp = dragPreviewRef.current;
    const all = dp ? drawingsRef.current.map(d => d.id === dp.id ? dp : d) : [...drawingsRef.current];
    if (activeDrawRef.current) all.push(activeDrawRef.current);

    for (const d of all) {
      const px1 = dataToPixel(d.p1);
      const px2 = dataToPixel(d.p2);
      if (!px1) continue;
      const isSelected = d.id === selectedId;

      ctx.strokeStyle = d.color;
      ctx.lineWidth = isSelected ? d.width + 1 : d.width;

      // Apply line style
      if (d.style === 'dashed') ctx.setLineDash([8, 4]);
      else if (d.style === 'dotted') ctx.setLineDash([2, 4]);
      else ctx.setLineDash([]);

      if (d.tool === 'trendline') {
        if (!px2) continue;
        ctx.beginPath(); ctx.moveTo(px1.x, px1.y); ctx.lineTo(px2.x, px2.y); ctx.stroke();
        _dot(ctx, px1, d.color); _dot(ctx, px2, d.color);

      } else if (d.tool === 'hline') {
        ctx.beginPath(); ctx.moveTo(0, px1.y); ctx.lineTo(canvas.width, px1.y); ctx.stroke();
        // Price label
        ctx.fillStyle = d.color + 'CC';
        ctx.fillRect(canvas.width - 70, px1.y - 10, 70, 18);
        ctx.fillStyle = '#fff';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(d.p1.price.toFixed(5), canvas.width - 35, px1.y + 3);
        ctx.textAlign = 'left';

      } else if (d.tool === 'vline') {
        ctx.beginPath(); ctx.moveTo(px1.x, 0); ctx.lineTo(px1.x, canvas.height); ctx.stroke();

      } else if (d.tool === 'ray') {
        if (!px2) continue;
        const dx = px2.x - px1.x, dy = px2.y - px1.y;
        const len = Math.sqrt(dx*dx + dy*dy);
        if (len > 1) {
          const t = Math.max(canvas.width, canvas.height) * 5 / len;
          ctx.beginPath(); ctx.moveTo(px1.x, px1.y); ctx.lineTo(px1.x + dx*t, px1.y + dy*t); ctx.stroke();
          _dot(ctx, px1, d.color);
        }

      } else if (d.tool === 'hray') {
        // Extends horizontally from p1 toward the newer (right) side of the chart —
        // the common convention for support/resistance rays drawn from a past candle.
        ctx.beginPath(); ctx.moveTo(px1.x, px1.y); ctx.lineTo(canvas.width, px1.y); ctx.stroke();
        _dot(ctx, px1, d.color);

      } else if (d.tool === 'arrow') {
        if (!px2) continue;
        const dx = px2.x - px1.x, dy = px2.y - px1.y;
        const angle = Math.atan2(dy, dx);
        ctx.beginPath(); ctx.moveTo(px1.x, px1.y); ctx.lineTo(px2.x, px2.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(px2.x, px2.y);
        ctx.lineTo(px2.x - 14*Math.cos(angle-0.4), px2.y - 14*Math.sin(angle-0.4));
        ctx.moveTo(px2.x, px2.y);
        ctx.lineTo(px2.x - 14*Math.cos(angle+0.4), px2.y - 14*Math.sin(angle+0.4));
        ctx.stroke();

      } else if (d.tool === 'rectangle') {
        if (!px2) continue;
        ctx.strokeRect(px1.x, px1.y, px2.x - px1.x, px2.y - px1.y);
        ctx.fillStyle = d.color + '18';
        ctx.fillRect(px1.x, px1.y, px2.x - px1.x, px2.y - px1.y);

      } else if (d.tool === 'ellipse') {
        if (!px2) continue;
        const cx = (px1.x + px2.x) / 2, cy = (px1.y + px2.y) / 2;
        const rx = Math.abs(px2.x - px1.x) / 2, ry = Math.abs(px2.y - px1.y) / 2;
        ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = d.color + '18'; ctx.fill();

      } else if (d.tool === 'triangle') {
        if (!px2) continue;
        const midX = (px1.x + px2.x) / 2;
        ctx.beginPath();
        ctx.moveTo(midX, px1.y);
        ctx.lineTo(px2.x, px2.y);
        ctx.lineTo(px1.x, px2.y);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = d.color + '15';
        ctx.fill();

      } else if (d.tool === 'channel') {
        if (!px2) continue;
        const heightDiff = (px2.y - px1.y);
        ctx.beginPath(); ctx.moveTo(px1.x, px1.y); ctx.lineTo(px2.x, px2.y); ctx.stroke();
        const offset = heightDiff * 0.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(px1.x, px1.y + offset); ctx.lineTo(px2.x, px2.y + offset); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(px1.x, px1.y - offset); ctx.lineTo(px2.x, px2.y - offset); ctx.stroke();
        ctx.fillStyle = d.color + '08';
        ctx.fillRect(px1.x, px1.y - offset, px2.x - px1.x, offset * 2);

      } else if (d.tool === 'fibonacci') {
        if (!px2) continue;
        const priceRange = d.p2.price - d.p1.price;
        const left = Math.min(px1.x, px2.x);
        const right = Math.max(px1.x, px2.x);
        FIB_LEVELS.forEach((lvl, i) => {
          const lvlPrice = d.p1.price + priceRange * lvl;
          // BUGFIX: this used to build { logical: d.p1.logical, price } — but
          // DataPoint only has {time, price}, so dataToPixel() always failed
          // and every Fibonacci level line silently never rendered.
          const lvlData  = { time: d.p1.time, price: lvlPrice };
          const lvlPx    = dataToPixel(lvlData);
          if (!lvlPx) return;
          ctx.strokeStyle = FIB_COLORS[i % FIB_COLORS.length];
          ctx.lineWidth = lvl === 0 || lvl === 1 ? 1.5 : 1;
          ctx.setLineDash(lvl === 0.5 ? [4,3] : []);
          ctx.beginPath(); ctx.moveTo(left, lvlPx.y); ctx.lineTo(right, lvlPx.y); ctx.stroke();
          ctx.fillStyle = FIB_COLORS[i % FIB_COLORS.length];
          ctx.font = '9px JetBrains Mono, monospace';
          ctx.setLineDash([]);
          ctx.fillText(`${(lvl * 100).toFixed(1)}%`, right + 4, lvlPx.y + 3);
        });
        ctx.strokeStyle = d.color; ctx.lineWidth = 1; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(px1.x, px1.y); ctx.lineTo(px1.x, px2.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(px2.x, px1.y); ctx.lineTo(px2.x, px2.y); ctx.stroke();

      } else if (d.tool === 'fibext') {
        if (!px2) continue;
        const priceRange = d.p2.price - d.p1.price;
        const left = Math.min(px1.x, px2.x);
        const right = Math.max(px1.x, px2.x);
        FIB_EXT_LEVELS.forEach((lvl, i) => {
          const lvlPrice = d.p1.price + priceRange * lvl;
          const lvlData  = { time: d.p1.time, price: lvlPrice }; // same bugfix as above
          const lvlPx    = dataToPixel(lvlData);
          if (!lvlPx) return;
          ctx.strokeStyle = FIB_EXT_COLORS[i % FIB_EXT_COLORS.length];
          ctx.lineWidth = lvl === 0 || lvl === 1 ? 1.5 : 1;
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(left, lvlPx.y); ctx.lineTo(right, lvlPx.y); ctx.stroke();
          ctx.fillStyle = FIB_EXT_COLORS[i % FIB_EXT_COLORS.length];
          ctx.font = '9px JetBrains Mono, monospace';
          ctx.fillText(`${(lvl * 100).toFixed(1)}%`, right + 4, lvlPx.y + 3);
        });

      } else if (d.tool === 'fibfan') {
        // Rays from p1 through the Fibonacci-ratio heights measured at p2's time.
        if (!px2) continue;
        const priceRange = d.p2.price - d.p1.price;
        FIB_LEVELS.forEach((lvl, i) => {
          const lvlPrice = d.p1.price + priceRange * lvl;
          const lvlPx = dataToPixel({ time: d.p2.time, price: lvlPrice });
          if (!lvlPx) return;
          const dx = lvlPx.x - px1.x, dy = lvlPx.y - px1.y;
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          const t = (Math.max(canvas.width, canvas.height) * 4) / len;
          ctx.strokeStyle = FIB_COLORS[i % FIB_COLORS.length];
          ctx.lineWidth = lvl === 0 || lvl === 1 ? 1.5 : 1;
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(px1.x, px1.y); ctx.lineTo(px1.x + dx * t, px1.y + dy * t); ctx.stroke();
        });
        _dot(ctx, px1, d.color); _dot(ctx, px2, d.color);

      } else if (d.tool === 'fibchannel') {
        // Parallel lines through p1–p2, offset by Fibonacci fractions of the
        // base leg's height — a channel version of the Fibonacci retracement.
        if (!px2) continue;
        const heightDiff = px2.y - px1.y;
        FIB_LEVELS.forEach((lvl, i) => {
          if (lvl === 0) return; // base line drawn separately below
          const offset = heightDiff * lvl;
          ctx.strokeStyle = FIB_COLORS[i % FIB_COLORS.length];
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(px1.x, px1.y - offset); ctx.lineTo(px2.x, px2.y - offset); ctx.stroke();
        });
        ctx.setLineDash([]);
        ctx.strokeStyle = d.color; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px1.x, px1.y); ctx.lineTo(px2.x, px2.y); ctx.stroke();
        _dot(ctx, px1, d.color); _dot(ctx, px2, d.color);

      } else if (d.tool === 'daterange') {
        // "Measure" tool: shows elapsed time + % price change between two points.
        if (!px2) continue;
        ctx.setLineDash([5, 4]);
        ctx.strokeRect(px1.x, px1.y, px2.x - px1.x, px2.y - px1.y);
        ctx.setLineDash([]);
        ctx.fillStyle = d.color + '12';
        ctx.fillRect(px1.x, px1.y, px2.x - px1.x, px2.y - px1.y);

        const pct = d.p1.price !== 0 ? ((d.p2.price - d.p1.price) / d.p1.price) * 100 : 0;
        const secs = Math.abs(d.p2.time - d.p1.time);
        const timeLabel = secs < 60 ? `${secs}s` : secs < 3600 ? `${Math.round(secs / 60)}m` : secs < 86400 ? `${Math.round(secs / 3600)}h` : `${Math.round(secs / 86400)}d`;
        const label = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%  ·  ${timeLabel}`;
        const midX = (px1.x + px2.x) / 2;
        const topY = Math.min(px1.y, px2.y);
        ctx.font = 'bold 11px JetBrains Mono, monospace';
        const tw = ctx.measureText(label).width + 16;
        ctx.fillStyle = pct >= 0 ? 'rgba(0,214,143,.92)' : 'rgba(255,61,87,.92)';
        ctx.fillRect(midX - tw / 2, topY - 24, tw, 20);
        ctx.fillStyle = '#04070E';
        ctx.textAlign = 'center';
        ctx.fillText(label, midX, topY - 10);
        ctx.textAlign = 'left';

      } else if (d.tool === 'pitchfork') {
        if (!px2) continue;
        const midY = (px1.y + px2.y) / 2;
        const midX = px1.x;
        const tip  = { x: midX, y: midY };
        ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(px2.x, (px1.y + px2.y)/2); ctx.stroke();
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(midX, px1.y); ctx.lineTo(px2.x + (px2.x - midX) * 0.3, px1.y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(midX, px2.y); ctx.lineTo(px2.x + (px2.x - midX) * 0.3, px2.y); ctx.stroke();
        ctx.setLineDash([]);
        _dot(ctx, px1, d.color); _dot(ctx, px2, d.color);
      }

      // Selection highlight + draggable endpoint handles
      if (isSelected) {
        ctx.strokeStyle = '#ffffff33';
        ctx.lineWidth = 6;
        ctx.setLineDash([]);
        if (px2 && d.tool !== 'hline' && d.tool !== 'vline') {
          ctx.beginPath(); ctx.moveTo(px1.x, px1.y); ctx.lineTo(px2.x, px2.y); ctx.stroke();
        }
        // Grab handles — larger than the plain end-dots so they're easy to
        // hit with a fingertip, letting the user drag either endpoint to
        // adjust the drawing instead of deleting and redrawing it.
        if (!drawMode) {
          if (d.tool !== 'hline' && d.tool !== 'vline') _handle(ctx, px1, d.color);
          if (px2) _handle(ctx, px2, d.color);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, drawMode]);

  // Coalesces redraw requests to at most one per animation frame. Touch
  // input can fire pointermove far faster than the screen refreshes
  // (100+ events/sec on some phones); calling the (fairly expensive —
  // fib fans, text labels, multiple strokes) redrawCanvas() synchronously
  // for every single one of those piles up more paint work than the frame
  // budget allows and is what actually reads as "choppy" while dragging,
  // even though React itself is no longer re-rendering per move.
  const rafPendingRef = useRef(false);
  const scheduleRedraw = useCallback(() => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      redrawCanvas();
    });
  }, [redrawCanvas]);

  function _handle(ctx: CanvasRenderingContext2D, p: {x:number;y:number}, color: string) {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI*2); ctx.stroke();
  }

  function _dot(ctx: CanvasRenderingContext2D, p: {x:number;y:number}, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#fff6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI*2); ctx.stroke();
  }

  // ─── LWC scroll/zoom → redraw ──────────────────────────────────────────────
  useEffect(() => {
    if (!chartRef.current) return;
    const unsub = chartRef.current.timeScale().subscribeVisibleLogicalRangeChange(() => {
      redrawCanvas();
    });
    return () => { try { unsub?.(); } catch {} };
  }, [redrawCanvas, lwcReady]);

  useEffect(() => { redrawCanvas(); }, [drawings, redrawCanvas]);

  // ─── Open trade price lines ────────────────────────────────────────────────
  useEffect(() => {
    if (!mainSeriesRef.current) return;
    const open = trades.filter(t => !t.resolved);
    priceLinesRef.current.forEach((pl, id) => {
      if (!open.find(t => t.id === id)) {
        try { mainSeriesRef.current.removePriceLine(pl); } catch {}
        priceLinesRef.current.delete(id);
      }
    });
    for (const trade of open) {
      if (!priceLinesRef.current.has(trade.id)) {
        try {
          const pl = mainSeriesRef.current.createPriceLine({
            price: trade.entry,
            color: trade.side === 'buy' ? '#00E676' : '#FF3D57',
            lineWidth: 1, lineStyle: 2, axisLabelVisible: true,
            title: `${trade.side === 'buy' ? '▲ BUY' : '▼ SELL'} ${trade.entry.toFixed(trade.dec)}`,
          });
          priceLinesRef.current.set(trade.id, pl);
        } catch {}
      }
    }
  }, [trades]);

  // ─── Build / rebuild chart ─────────────────────────────────────────────────
  const buildChart = useCallback(() => {
    if (!lwcReady || !containerRef.current || !currentMarket) return;
    const buildId = ++buildIdRef.current; // this build is now the only one allowed to write shared state
    priceLinesRef.current.clear();
    if (shortTFTimerRef.current) { clearInterval(shortTFTimerRef.current); shortTFTimerRef.current = null; }
    if (subChartRef.current) { try { subChartRef.current.remove(); } catch {} subChartRef.current = null; }
    if (chartRef.current)    { try { chartRef.current.remove(); }    catch {} chartRef.current    = null; }
    whitespaceSeriesRef.current = null; // removed along with chartRef.current above
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }

    const chart = LightweightCharts.createChart(containerRef.current, {
      layout: { background: { color: bg }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor, scaleMargins: { top: 0.08, bottom: 0.08 } },
      timeScale: { borderColor, timeVisible: true, secondsVisible: true, rightOffset: 20 },
      crosshair: { mode: 1 },
      // CRITICAL: handleScroll and handleScale must be true so chart can zoom/pan
      handleScroll: true,
      handleScale: true,
      width:  containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });
    chartRef.current = chart;

    let mainSeries: any;
    if (chartType === 'Candles' || chartType === 'HeikinAshi') {
      mainSeries = chart.addCandlestickSeries({
        upColor:'#00E676', downColor:'#FF3D57',
        wickUpColor:'#00E676', wickDownColor:'#FF3D57',
        borderVisible: false,
      });
    } else if (chartType === 'Bars') {
      mainSeries = chart.addBarSeries({ upColor:'#00E676', downColor:'#FF3D57' });
    } else if (chartType === 'Line') {
      mainSeries = chart.addLineSeries({ color:'#00E676', lineWidth:2 });
    } else {
      mainSeries = chart.addAreaSeries({
        topColor:'rgba(0,230,118,.15)', bottomColor:'rgba(0,230,118,0)',
        lineColor:'#00E676', lineWidth:2,
      });
    }
    mainSeriesRef.current = mainSeries;

    // Transparent helper series — carries only future whitespace points so
    // the time scale extends forward without ever touching mainSeries'
    // own data (see whitespaceSeriesRef comment above).
    const whitespaceSeries = chart.addLineSeries({
      color: 'transparent', lineWidth: 1,
      lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
    });
    whitespaceSeriesRef.current = whitespaceSeries;

    const hasSubInd = activeInds.some(id => ['rsi','macd','stoch','williams','cci','atr','volume','adx','momentum','mfi'].includes(id));
    setHasSubChart(hasSubInd);

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => redrawCanvas());

    loadData(chart, mainSeries, hasSubInd, buildId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lwcReady, currentMarket?.symbol, currentTF, chartType, theme, activeInds, indicatorSettings]);

  async function loadData(chart: any, mainSeries: any, hasSubInd: boolean, buildId: number) {
    if (!currentMarket) return;
    setLoading(true);
    let bars: any[];
    const isShortTF = (SHORT_TFS as string[]).includes(currentTF);

    try {
      if (isShortTF) {
        // For short timeframes: fetch 1m bars and subdivide
        const oneMBars = await fetchBinanceKlines(currentMarket.symbol, '1m', 200);
        const tfSec = TIMEFRAMES[currentTF].sec;
        bars = genShortTFData(oneMBars, tfSec);
      } else {
        bars = await fetchBinanceKlines(currentMarket.symbol, TIMEFRAMES[currentTF].binance, 500);
      }
    } catch {
      bars = genSimData(currentMarket.price, currentTF, 500);
    }

    // A newer buildChart() ran while we were awaiting the fetch above (fast
    // market/timeframe switch). This build is stale — bail out before
    // touching barsRef/wsRef/mainSeries or pushing a wrong-symbol price
    // into the store. The chart/mainSeries this build was working with may
    // already be .remove()'d.
    if (buildId !== buildIdRef.current) return;

    barsRef.current = bars;
    // Transform bars for special chart types
    const haData = chartType === 'HeikinAshi' ? calcHeikinAshi(bars) : bars;
    const data = (chartType === 'Candles' || chartType === 'HeikinAshi' || chartType === 'Bars')
      ? haData
      : bars.map(b => ({ time: b.time, value: b.close }));
    const tfSecForPad = TIMEFRAMES[currentTF].sec;
    try { mainSeries.setData(data); } catch {}
    try {
      whitespaceSeriesRef.current?.setData(futureWhitespaceOnly(data[data.length - 1].time, tfSecForPad));
    } catch {}
    // Fit the real bars (as fitContent() used to) but leave a chunk of the
    // future whitespace visible on the right so there's obvious empty room
    // to draw Fibonacci/trend-line projections into, instead of jumping to
    // the full 150-bar padding.
    try {
      chart.timeScale().setVisibleLogicalRange({ from: 0, to: data.length - 1 + 20 });
    } catch { chart.timeScale().fitContent(); }
    setLoading(false);
    applyMainIndicators(chart, bars);
    if (hasSubInd) buildSubChart(bars);

    if (isShortTF) {
      connectShortTFTimer(mainSeries, chart, buildId);
    } else {
      connectWS(mainSeries, chart, buildId);
    }
    setTimeout(() => redrawCanvas(), 100);
  }

  function applyMainIndicators(chart: any, bars: any[]) {
    const mainInd = activeInds.filter(id => ['bb','ema20','sma20','vwap','wma20','donchian'].includes(id));
    for (const id of mainInd) {
      if (id === 'bb') {
        const p = indicatorSettings.bb?.period || 20, m = indicatorSettings.bb?.mult || 2;
        const bb = calcBB(bars, p, m);
        const up = chart.addLineSeries({ color:'rgba(59,130,246,.8)', lineWidth:1 });
        const lo = chart.addLineSeries({ color:'rgba(59,130,246,.8)', lineWidth:1 });
        const mi = chart.addLineSeries({ color:'rgba(59,130,246,.4)', lineWidth:1, lineStyle:1 });
        up.setData(bb.upper); lo.setData(bb.lower); mi.setData(bb.mid);
      } else if (id === 'ema20') {
        const p = indicatorSettings.ema20?.period || 20;
        chart.addLineSeries({ color:'#F59E0B', lineWidth:1.5 }).setData(calcEMA(bars, p));
      } else if (id === 'sma20') {
        const p = indicatorSettings.sma20?.period || 20;
        chart.addLineSeries({ color:'#8B5CF6', lineWidth:1.5, lineStyle:2 }).setData(calcSMA(bars, p));
      } else if (id === 'vwap') {
        chart.addLineSeries({ color:'#22D3EE', lineWidth:1.5 }).setData(calcVWAP(bars));
      } else if (id === 'wma20') {
        const p = indicatorSettings.wma20?.period || 20;
        chart.addLineSeries({ color:'#84CC16', lineWidth:1.5, lineStyle:3 }).setData(calcWMA(bars, p));
      } else if (id === 'donchian') {
        const p = indicatorSettings.donchian?.period || 20;
        const dc = calcDonchian(bars, p);
        chart.addLineSeries({ color:'rgba(168,85,247,.8)', lineWidth:1 }).setData(dc.upper);
        chart.addLineSeries({ color:'rgba(168,85,247,.8)', lineWidth:1 }).setData(dc.lower);
      }
    }
  }

  function buildSubChart(bars: any[]) {
    if (!subContainerRef.current) return;
    if (subChartRef.current) { try { subChartRef.current.remove(); } catch {} subChartRef.current = null; }
    const subInds = activeInds.filter(id => ['rsi','macd','stoch','williams','cci','atr','volume','adx','momentum','mfi'].includes(id));
    if (!subInds.length) return;

    const subChart = LightweightCharts.createChart(subContainerRef.current, {
      layout: { background: { color: bg }, textColor },
      grid: { vertLines: { color: gridColor }, horzLines: { color: gridColor } },
      rightPriceScale: { borderColor, scaleMargins: { top:0.08, bottom:0.08 } },
      timeScale: { borderColor, visible: false },
      crosshair: { mode: 1 },
      handleScroll: true, handleScale: false,
      width:  subContainerRef.current.clientWidth,
      height: subContainerRef.current.clientHeight,
    });
    subChartRef.current = subChart;

    if (chartRef.current) {
      chartRef.current.timeScale().subscribeVisibleLogicalRangeChange((range: any) => {
        if (range && subChartRef.current) try { subChartRef.current.timeScale().setVisibleLogicalRange(range); } catch {}
      });
    }

    const id = subInds[0];
    if (id === 'rsi') {
      const p = indicatorSettings.rsi?.period || 14;
      const s = subChart.addLineSeries({ color:'#F59E0B', lineWidth:2 });
      s.setData(calcRSI(bars, p));
      s.createPriceLine({ price:70, color:'rgba(255,61,87,.5)', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'70' });
      s.createPriceLine({ price:30, color:'rgba(0,230,118,.5)', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'30' });
      s.createPriceLine({ price:50, color:'rgba(255,255,255,.15)', lineWidth:1, lineStyle:2, axisLabelVisible:false });
    } else if (id === 'macd') {
      const md = calcMACD(bars);
      const hist = subChart.addHistogramSeries({ priceScaleId:'right' });
      hist.setData(md.hist);
      subChart.addLineSeries({ color:'#3B82F6', lineWidth:2 }).setData(md.macd);
      subChart.addLineSeries({ color:'#EC4899', lineWidth:1.5 }).setData(md.signal);
    } else if (id === 'stoch') {
      const kP = indicatorSettings.stoch?.k || 14;
      const sd = calcStoch(bars, kP);
      const kL = subChart.addLineSeries({ color:'#06B6D4', lineWidth:2 });
      kL.setData(sd.k);
      subChart.addLineSeries({ color:'#F97316', lineWidth:1.5, lineStyle:1 }).setData(sd.d);
      kL.createPriceLine({ price:80, color:'rgba(255,61,87,.4)', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'80' });
      kL.createPriceLine({ price:20, color:'rgba(0,230,118,.4)', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'20' });
    } else if (id === 'cci') {
      const p = indicatorSettings.cci?.period || 14;
      const s = subChart.addLineSeries({ color:'#10B981', lineWidth:2 });
      s.setData(calcCCI(bars, p));
      s.createPriceLine({ price:100, color:'rgba(255,61,87,.4)', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'+100' });
      s.createPriceLine({ price:-100, color:'rgba(0,230,118,.4)', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'-100' });
    } else if (id === 'atr') {
      const p = indicatorSettings.atr?.period || 14;
      subChart.addLineSeries({ color:'#EC4899', lineWidth:2 }).setData(calcATR(bars, p));
    } else if (id === 'williams') {
      const p = indicatorSettings.williams?.period || 14;
      const s = subChart.addLineSeries({ color:'#F97316', lineWidth:2 });
      s.setData(calcWilliams(bars, p));
      s.createPriceLine({ price:-20, color:'rgba(255,61,87,.4)', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'-20' });
      s.createPriceLine({ price:-80, color:'rgba(0,230,118,.4)', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'-80' });
    } else if (id === 'volume') {
      subChart.addHistogramSeries({ priceScaleId:'right', priceFormat:{ type:'volume' } }).setData(calcVolume(bars));
    } else if (id === 'adx') {
      const p = indicatorSettings.adx?.period || 14;
      const s = subChart.addLineSeries({ color:'#EF4444', lineWidth:2 });
      s.setData(calcADX(bars, p));
      s.createPriceLine({ price:25, color:'rgba(255,255,255,.15)', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'25' });
    } else if (id === 'momentum') {
      const p = indicatorSettings.momentum?.period || 10;
      const s = subChart.addLineSeries({ color:'#FACC15', lineWidth:2 });
      s.setData(calcMomentum(bars, p));
      s.createPriceLine({ price:0, color:'rgba(255,255,255,.15)', lineWidth:1, lineStyle:2, axisLabelVisible:false });
    } else if (id === 'mfi') {
      const p = indicatorSettings.mfi?.period || 14;
      const s = subChart.addLineSeries({ color:'#FB7185', lineWidth:2 });
      s.setData(calcMFI(bars, p));
      s.createPriceLine({ price:80, color:'rgba(255,61,87,.4)', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'80' });
      s.createPriceLine({ price:20, color:'rgba(0,230,118,.4)', lineWidth:1, lineStyle:2, axisLabelVisible:true, title:'20' });
    }
  }

  // ─── Short timeframe live simulation ─────────────────────────────────────
  function connectShortTFTimer(mainSeries: any, chart: any, buildId: number) {
    if (!currentMarket) return;
    const tfSec = TIMEFRAMES[currentTF].sec;
    let lastBar = barsRef.current[barsRef.current.length - 1];
    let tickCount = 0;
    const totalTicks = Math.ceil(tfSec / 0.5);

    // Fetch real price from Binance
    let currentPrice = lastBar?.close || currentMarket.price;
    const fetchPrice = async () => {
      try {
        const r = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${currentMarket.symbol}`);
        if (r.ok) { const d = await r.json(); currentPrice = parseFloat(d.price); }
      } catch {}
    };
    fetchPrice();

    shortTFTimerRef.current = setInterval(async () => {
      // A newer build has taken over (market/timeframe switched) — this
      // interval belongs to the old one and must not push its price into
      // the store or touch a mainSeries that's already been removed.
      if (buildId !== buildIdRef.current) { clearInterval(shortTFTimerRef.current); return; }
      tickCount++;
      const now = Math.floor(Date.now() / 1000);
      const barStart = Math.floor(now / tfSec) * tfSec;

      // Fetch real price every 2 ticks (every 1s) instead of every 500ms
      // to avoid flooding the network on mobile and causing freezes.
      if (tickCount % 2 === 0) await fetchPrice();
      if (buildId !== buildIdRef.current) return; // stale after the awaited fetch too
      setLivePrice(currentPrice);

      if (!lastBar || barStart > lastBar.time) {
        // New candle
        const newBar = { time: barStart, open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice, volume: 0 };
        barsRef.current.push(newBar);
        if (barsRef.current.length > 1000) barsRef.current.shift();
        lastBar = newBar;
        // Top up the future whitespace so the projectable space for
        // drawings doesn't shrink as the session runs long.
        try { whitespaceSeriesRef.current?.update({ time: newBar.time + FUTURE_WHITESPACE_BARS * tfSec }); } catch {}
      } else {
        // Update current candle
        lastBar.close = currentPrice;
        lastBar.high = Math.max(lastBar.high, currentPrice);
        lastBar.low = Math.min(lastBar.low, currentPrice);
      }

      const upd = (chartType === 'Candles' || chartType === 'HeikinAshi' || chartType === 'Bars')
        ? lastBar : { time: lastBar.time, value: lastBar.close };
      try { mainSeries.update(upd); } catch {}
    }, 500);
  }

  // ─── WebSocket for normal timeframes ──────────────────────────────────────
  function connectWS(mainSeries: any, chart: any, buildId: number) {
    if (!currentMarket) return;
    const sym = currentMarket.symbol.toLowerCase();
    let lastMsgAt = Date.now();

    function open() {
      // Another buildChart() has already taken over — don't even open the
      // socket for a market/timeframe combo that's no longer on screen.
      if (buildId !== buildIdRef.current) return;
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${sym}@kline_${TIMEFRAMES[currentTF].binance}`);
      ws.onmessage = (e) => {
        // Stale build: a market/timeframe switch happened after this socket
        // was opened. Ignore the message instead of overwriting wsRef,
        // barsRef, or the shared livePrice with data for a symbol that's
        // no longer the one being displayed/traded.
        if (buildId !== buildIdRef.current) { try { ws.close(); } catch {} return; }
        lastMsgAt = Date.now();
        const d = JSON.parse(e.data), k = d.k;
        const closePrice = parseFloat(k.c);
        const bar = {
          time: k.t/1000, open: parseFloat(k.o), high: parseFloat(k.h),
          low: parseFloat(k.l), close: closePrice, volume: parseFloat(k.v),
        };
        // Keep livePrice in sync so openTrade() always uses the real current price
        setLivePrice(closePrice);
        const bars = barsRef.current;
        const last = bars[bars.length-1];
        if (last && bar.time === last.time) bars[bars.length-1] = bar;
        else {
          bars.push(bar); if (bars.length > 1000) bars.shift();
          // Top up the future whitespace so the projectable space for
          // drawings doesn't shrink as the session runs long.
          try { whitespaceSeriesRef.current?.update({ time: bar.time + FUTURE_WHITESPACE_BARS * TIMEFRAMES[currentTF].sec }); } catch {}
        }
        const upd = (chartType === 'Candles' || chartType === 'HeikinAshi' || chartType === 'Bars')
          ? bar : { time: bar.time, value: bar.close };
        try { mainSeries.update(upd); } catch {}
      };
      // Only reconnect if this socket is still the active one — avoids a
      // reconnect loop firing after an intentional teardown (unmount/rebuild).
      ws.onclose = () => { if (wsRef.current === ws && buildId === buildIdRef.current) setTimeout(open, 1500); };
      ws.onerror = () => { try { ws.close(); } catch {} };
      wsRef.current = ws;
    }
    open();

    // Watchdog: a flaky mobile connection can drop the socket without ever
    // firing onclose/onerror. If no kline update arrives for 8s, force a
    // reconnect so the chart (and live price) don't silently freeze.
    wsStaleTimerRef.current = setInterval(() => {
      if (buildId !== buildIdRef.current) { clearInterval(wsStaleTimerRef.current); return; }
      if (wsRef.current && Date.now() - lastMsgAt > 8000) {
        try { wsRef.current.close(); } catch {}
        open();
      }
    }, 4000);
  }

  useEffect(() => {
    buildChart();
    return () => {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null; }
      if (shortTFTimerRef.current) { clearInterval(shortTFTimerRef.current); shortTFTimerRef.current = null; }
      if (wsStaleTimerRef.current) { clearInterval(wsStaleTimerRef.current); wsStaleTimerRef.current = null; }
    };
  }, [buildChart]);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(() => {
      if (chartRef.current && containerRef.current)
        chartRef.current.resize(containerRef.current.clientWidth, containerRef.current.clientHeight);
      if (subChartRef.current && subContainerRef.current)
        subChartRef.current.resize(subContainerRef.current.clientWidth, subContainerRef.current.clientHeight);
      redrawCanvas();
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [lwcReady, hasSubChart, redrawCanvas]);

  // Keep canvas sized
  useEffect(() => {
    const canvas = canvasRef.current, cont = containerRef.current;
    if (!canvas || !cont) return;
    const sync = () => { canvas.width = cont.clientWidth; canvas.height = cont.clientHeight; redrawCanvas(); };
    sync();
    const obs = new ResizeObserver(sync);
    obs.observe(cont);
    return () => obs.disconnect();
  }, [hasSubChart, redrawCanvas]);

  // ─── Canvas pointer events (unifies mouse + touch/stylus) ─────────────────
  // Using Pointer Events instead of mouse-only events is what makes the
  // drawing tools actually usable with a finger on a phone: touch never
  // fired onMouseDown/Move/Up at all, so nothing could be drawn or dragged.
  const longPressTimerRef = useRef<any>(null);
  const pointerMovedRef   = useRef(false);

  // Endpoint / whole-shape dragging for the currently selected drawing —
  // this is what lets a finished drawing be nudged into place afterwards
  // instead of deleting it and redrawing from scratch.
  interface DragState { id: string; mode: 'p1' | 'p2' | 'move'; origP1: DataPoint; origP2: DataPoint; startDP: DataPoint; }
  const dragStateRef = useRef<DragState | null>(null);

  function _canvasPos(clientX: number, clientY: number) {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  function _clearLongPress() {
    if (longPressTimerRef.current) { clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null; }
  }

  const HANDLE_HIT_R = 16; // generous touch target for dragging an endpoint

  // Hit-tests the drawings at (x,y) and, if something editable is under the
  // pointer (an endpoint handle, an h-line/v-line, or a shape's body), grabs
  // it: arms dragStateRef / selectedId / the long-press-to-edit timer exactly
  // as this used to do only while "Cursor" mode was switched on. Returns
  // true if it grabbed something (the caller should keep this gesture on the
  // drawing layer instead of letting it fall through to chart panning).
  function _tryGrabDrawing(pos: { x: number; y: number }): boolean {
    if (selectedId) {
      const d = drawingsRef.current.find(x => x.id === selectedId);
      if (d) {
        const px1 = dataToPixel(d.p1);
        const px2 = d.p2 ? dataToPixel(d.p2) : null;
        const startDP = pixelToData(pos.x, pos.y);
        if (px1 && d.tool !== 'hline' && d.tool !== 'vline' && Math.hypot(pos.x - px1.x, pos.y - px1.y) < HANDLE_HIT_R && startDP) {
          dragStateRef.current = { id: d.id, mode: 'p1', origP1: d.p1, origP2: d.p2, startDP };
          return true;
        }
        if (px2 && Math.hypot(pos.x - px2.x, pos.y - px2.y) < HANDLE_HIT_R && startDP) {
          dragStateRef.current = { id: d.id, mode: 'p2', origP1: d.p1, origP2: d.p2, startDP };
          return true;
        }
        if ((d.tool === 'hline' || d.tool === 'vline') && px1) {
          const near = d.tool === 'hline' ? Math.abs(pos.y - px1.y) < 10 : Math.abs(pos.x - px1.x) < 10;
          if (near && startDP) {
            dragStateRef.current = { id: d.id, mode: 'p1', origP1: d.p1, origP2: d.p2, startDP };
            return true;
          }
        }
        if (px1 && px2 && startDP && pointToSegmentDist(pos.x, pos.y, px1.x, px1.y, px2.x, px2.y) < 8) {
          dragStateRef.current = { id: d.id, mode: 'move', origP1: d.p1, origP2: d.p2, startDP };
          return true;
        }
      }
    }

    // Nothing already selected (or the touch missed its handles) — normal
    // hit-test against every drawing. Touch has no right-click, so a
    // long-press on a drawing opens the same edit dialog a desktop
    // right-click would.
    const hit = findDrawingAt(pos.x, pos.y);
    setSelectedId(hit?.id || null);
    if (hit) {
      longPressTimerRef.current = setTimeout(() => {
        if (!pointerMovedRef.current) setEditDraw(hit);
      }, 500);
      return true;
    }
    return false; // empty space — leave it alone so the chart pans/zooms normally
  }

  // Whenever a drawing-layer gesture (drag or draw) finishes, hand pointer
  // interaction back to the chart underneath instead of leaving the overlay
  // canvas "on top" — this is what removes the old requirement to manually
  // flip a Cursor/selection toggle just to be able to pan again afterwards.
  function _releaseCanvasToChart(pointerId?: number) {
    const canvas = canvasRef.current;
    // Hand panning/zooming back to LWC itself — this is the authoritative
    // fix: instead of racing LWC's internal touch/pointer handling to see
    // who reacts to the raw event first, we tell the chart directly that
    // it's allowed to scroll/scale again. Whatever input mechanism LWC
    // uses internally, it will respect this flag.
    try { chartRef.current?.applyOptions({ handleScroll: true, handleScale: true }); } catch {}
    if (!canvas) return;
    try { if (pointerId != null) canvas.releasePointerCapture(pointerId); } catch {}
    if (!drawMode) canvas.style.pointerEvents = 'none';
  }

  function onCanvasPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    // Only reached while drawMode is active (placing a new drawing) — once
    // idle, the overlay is click-through and _containerPointerDown below is
    // what grabs existing drawings instead.
    if (!drawMode) return;
    e.preventDefault();
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch {}
    try { chartRef.current?.applyOptions({ handleScroll: false, handleScale: false }); } catch {}
    pointerMovedRef.current = false;
    const pos = _canvasPos(e.clientX, e.clientY);
    const dp  = pixelToData(pos.x, pos.y);
    if (!dp) return;
    isDrawingRef.current  = true;
    activeDrawRef.current = {
      id: Date.now().toString(), tool: drawMode,
      p1: dp, p2: dp,
      color: drawColor, width: drawWidth, style: drawStyle,
      finished: false,
    };
    redrawCanvas();
  }

  function onCanvasPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    pointerMovedRef.current = true;
    _clearLongPress();

    if (dragStateRef.current) {
      e.preventDefault();
      const pos = _canvasPos(e.clientX, e.clientY);
      const dp  = pixelToData(pos.x, pos.y);
      if (!dp) return;
      const drag = dragStateRef.current;
      const base = drawingsRef.current.find(d => d.id === drag.id);
      if (!base) return;
      let next: Drawing;
      if (drag.mode === 'p1') next = { ...base, p1: dp };
      else if (drag.mode === 'p2') next = { ...base, p2: dp };
      else {
        // 'move' — shift both points by the same time/price delta
        const deltaTime  = dp.time - drag.startDP.time;
        const deltaPrice = dp.price - drag.startDP.price;
        next = {
          ...base,
          p1: { time: drag.origP1.time + deltaTime, price: drag.origP1.price + deltaPrice },
          p2: { time: drag.origP2.time + deltaTime, price: drag.origP2.price + deltaPrice },
        };
      }
      // Write to the ref and schedule a redraw — no setDrawings here, so
      // no React re-render on every pointermove, and no more than one
      // canvas repaint per animation frame. Smooth dragging.
      dragPreviewRef.current = next;
      scheduleRedraw();
      return;
    }

    if (!isDrawingRef.current || !activeDrawRef.current) return;
    e.preventDefault();
    const pos = _canvasPos(e.clientX, e.clientY);
    const dp  = pixelToData(pos.x, pos.y);
    if (!dp) return;
    activeDrawRef.current.p2 = dp;
    scheduleRedraw();
  }

  function onCanvasPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    _clearLongPress();

    if (dragStateRef.current) {
      const finalPos = dragPreviewRef.current;
      dragStateRef.current = null;
      if (finalPos) {
        // Single commit to React state now that the gesture is done —
        // this is the only setDrawings call in the whole drag, instead of
        // one per pointermove.
        setDrawings(prev => prev.map(d => d.id === finalPos.id ? finalPos : d));
      }
      dragPreviewRef.current = null;
      _releaseCanvasToChart(e.pointerId);
      redrawCanvas();
      return;
    }

    if (!isDrawingRef.current || !activeDrawRef.current) {
      // A plain tap/click that only selected (or deselected) a drawing —
      // still hand control back to the chart so it can pan immediately.
      _releaseCanvasToChart(e.pointerId);
      return;
    }
    const pos = _canvasPos(e.clientX, e.clientY);
    const dp  = pixelToData(pos.x, pos.y);
    if (dp) activeDrawRef.current.p2 = dp;
    const finished = { ...activeDrawRef.current, finished: true };
    setDrawings(prev => [...prev, finished]);
    activeDrawRef.current = null;
    isDrawingRef.current  = false;

    // Auto-turn-off the tool after every drawing instead of leaving it
    // armed — no need to go back to the toolbox and switch it off by hand.
    setDrawMode(null);
    setSelectedId(finished.id);
    _releaseCanvasToChart(e.pointerId);
    redrawCanvas();
  }

  // Idle-state entry point: while nothing is being drawn/dragged, the
  // overlay canvas is pointer-events:none so the chart underneath always
  // pans/zooms freely. This listener sits on the *container* (which keeps
  // receiving events regardless of the canvas's pointer-events value) and
  // does a cheap hit-test the instant a touch/click lands — only if it
  // actually lands on a drawing does it switch the canvas on and take over
  // the gesture, so editing a drawing no longer requires a manual Cursor
  // toggle beforehand.
  useEffect(() => {
    const cont = containerRef.current;
    if (!cont) return;
    function handleDown(e: PointerEvent) {
      if (drawMode) return; // the canvas is already fully interactive in this case
      if (e.target === canvasRef.current) return; // already handled directly
      const pos = _canvasPos(e.clientX, e.clientY);
      pointerMovedRef.current = false;
      const grabbed = _tryGrabDrawing(pos);
      if (!grabbed) return; // empty space — let the chart handle panning/zooming
      // Primary fix: tell LWC directly to stop scrolling/scaling for the
      // duration of this gesture. This works no matter which input pathway
      // LWC uses internally (pointer events, raw touch events, mouse
      // events) — unlike racing the raw DOM event with stopPropagation,
      // which only helps if LWC happens to listen via pointer events too.
      try { chartRef.current?.applyOptions({ handleScroll: false, handleScale: false }); } catch {}
      // Also stop the raw event from reaching LWC's own canvas, in case it
      // does listen via pointer events for something applyOptions doesn't
      // cover (e.g. crosshair tracking) — belt and suspenders.
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.pointerEvents = 'all';
        try { canvas.setPointerCapture(e.pointerId); } catch {}
      }
      redrawCanvas();
    }
    cont.addEventListener('pointerdown', handleDown, true); // capture phase

    // Right-click also needs a container-level listener for the same
    // reason: the overlay canvas doesn't receive it while click-through.
    function handleContextMenu(e: MouseEvent) {
      if (drawMode || e.target === canvasRef.current) return;
      const pos = _canvasPos(e.clientX, e.clientY);
      const hit = findDrawingAt(pos.x, pos.y);
      if (hit) { e.preventDefault(); setEditDraw(hit); setSelectedId(hit.id); }
    }
    cont.addEventListener('contextmenu', handleContextMenu);

    return () => {
      cont.removeEventListener('pointerdown', handleDown, true);
      cont.removeEventListener('contextmenu', handleContextMenu);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawMode, selectedId, redrawCanvas]);

  function onCanvasRightClick(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const pos = _canvasPos(e.clientX, e.clientY);
    const hit = findDrawingAt(pos.x, pos.y);
    if (hit) { setEditDraw(hit); setSelectedId(hit.id); }
  }

  function findDrawingAt(px: number, py: number): Drawing | null {
    for (const d of [...drawingsRef.current].reverse()) {
      const p1 = dataToPixel(d.p1);
      if (!p1) continue;
      if (d.tool === 'hline') { if (Math.abs(py - p1.y) < 8) return d; }
      else if (d.tool === 'vline') { if (Math.abs(px - p1.x) < 8) return d; }
      else {
        const p2 = dataToPixel(d.p2);
        if (!p2) continue;
        if (pointToSegmentDist(px, py, p1.x, p1.y, p2.x, p2.y) < 8) return d;
      }
    }
    return null;
  }

  function pointToSegmentDist(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
    const dx = x2-x1, dy = y2-y1;
    const lenSq = dx*dx + dy*dy;
    if (lenSq === 0) return Math.sqrt((px-x1)**2 + (py-y1)**2);
    const t = Math.max(0, Math.min(1, ((px-x1)*dx + (py-y1)*dy) / lenSq));
    return Math.sqrt((px - (x1+t*dx))**2 + (py - (y1+t*dy))**2);
  }

  const subInds = activeInds.filter(id => ['rsi','macd','stoch','williams','cci','atr','volume','adx','momentum','mfi'].includes(id));
  const subLabel: Record<string,string> = { rsi:'RSI', macd:'MACD', stoch:'Stochastic', cci:'CCI', atr:'ATR', williams:'Williams %R', volume:'Volume', adx:'ADX', momentum:'Momentum', mfi:'MFI' };

  const allToolsFlat = TOOL_GROUPS.flatMap(g => g.tools);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>

      {/* ── Timeframe + Chart-type bar ─────────────────────────────────────── */}
      <div className="tf-bar">
        {TFS.map(tf => (
          <button
            key={tf}
            className={`tf-btn ${currentTF === tf ? 'active' : ''} ${(SHORT_TFS as string[]).includes(tf) ? 'tf-short' : ''}`}
            onClick={() => setCurrentTF(tf)}
          >{tf}</button>
        ))}
        <div style={{ width:1, height:16, background:'var(--border)', margin:'0 4px', flexShrink:0 }} />
        {CHART_TYPES.map(ct => (
          <button
            key={ct}
            title={ct}
            className={`tf-btn ct-icon-btn ${chartType === ct ? 'active' : ''}`}
            onClick={() => setChartType(ct)}
          >{CHART_TYPE_ICONS[ct]}</button>
        ))}
      </div>

      {/* ── Chart body ────────────────────────────────────────────────────── */}
      <div style={{ flex:1, position:'relative', minHeight:0 }}>
        <div
          ref={containerRef}
          style={{ width:'100%', height: hasSubChart ? 'calc(100% - 130px)' : '100%', position:'relative' }}
        >
          {/* Canvas: fully interactive while placing a new drawing (drawMode).
               Otherwise it's click-through (pointerEvents:none) so the chart
               always pans/zooms freely — the container-level listener below
               switches it back on for the duration of a gesture the instant
               a touch/click actually lands on an existing drawing. */}
          <canvas
            ref={canvasRef}
            style={{
              position:'absolute', inset:0, zIndex:10,
              pointerEvents: drawMode ? 'all' : 'none',
              cursor: drawMode ? 'crosshair' : 'default',
              touchAction: 'none',
            }}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onPointerCancel={onCanvasPointerUp}
            onContextMenu={onCanvasRightClick}
          />
        </div>

        {/* Sub chart */}
        {hasSubChart && subInds.length > 0 && (
          <div style={{ position:'absolute', bottom:0, left:0, right:0, height:130, display:'flex', flexDirection:'column' }}>
            <div style={{
              padding:'4px 10px', fontSize:10, fontWeight:700,
              color:'var(--t4)', background:'var(--bg1)',
              borderTop:'1px solid var(--border)', display:'flex', gap:8,
            }}>
              {subInds.map(id => (
                <span
                  key={id}
                  style={{ color: id === subInds[0] ? 'var(--g0)' : 'var(--t4)', cursor:'pointer' }}
                  onClick={() => useStore.setState(s => ({ activeInds: [id, ...s.activeInds.filter(x => x !== id)] }))}
                >
                  {subLabel[id] || id.toUpperCase()}
                </span>
              ))}
            </div>
            <div ref={subContainerRef} style={{ flex:1 }} />
          </div>
        )}

        {/* ── Drawing tools toggle button ─────────────────────────────────── */}
        <button
          onClick={() => setToolsOpen(o => !o)}
          style={{
            position:'absolute', left: toolsOpen ? 208 : 6, top:8, zIndex:30,
            width:28, height:28, borderRadius:8,
            border:`1px solid ${toolsOpen ? 'var(--g0)' : 'var(--border2)'}`,
            background: toolsOpen ? 'rgba(0,230,118,.15)' : 'var(--bg2)',
            color: toolsOpen ? 'var(--g0)' : 'var(--t3)',
            fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
            transition:'all .2s', boxShadow:'0 2px 8px rgba(0,0,0,.3)',
          }}
          title={toolsOpen ? 'Close Tools' : 'Drawing Tools'}
        >
          {toolsOpen
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          }
        </button>

        {/* ── Drawing tools panel ────────────────────────────────────────── */}
        {toolsOpen && (
          <div style={{
            position:'absolute', left:6, top:8, zIndex:29, width:200,
            background:'var(--bg1)', border:'1px solid var(--border2)', borderRadius:12,
            padding:0, boxShadow:'0 8px 32px rgba(0,0,0,.5)',
            overflow:'hidden',
          }}>
            {/* Panel header */}
            <div style={{ padding:'10px 12px 8px', borderBottom:'1px solid var(--border)' }}>
              <div style={{ fontSize:11, fontWeight:800, color:'var(--t3)', letterSpacing:'.8px', textTransform:'uppercase', marginBottom:8 }}>Drawing Tools</div>

              {/* Color palette */}
              <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:8 }}>
                {DEFAULT_COLORS.map(c => (
                  <div
                    key={c}
                    onClick={() => setDrawColor(c)}
                    style={{
                      width:18, height:18, borderRadius:4, background:c, cursor:'pointer',
                      border: drawColor === c ? '2px solid #fff' : '2px solid transparent',
                      boxShadow: drawColor === c ? `0 0 6px ${c}80` : 'none',
                      transition:'all .15s',
                    }}
                  />
                ))}
                <input
                  type="color" value={drawColor}
                  onChange={e => setDrawColor(e.target.value)}
                  style={{ width:18, height:18, borderRadius:4, border:'none', cursor:'pointer', padding:0, background:'none' }}
                  title="Custom color"
                />
              </div>

              {/* Line width */}
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                <span style={{ fontSize:10, color:'var(--t4)', fontWeight:600, width:36 }}>Width</span>
                <input
                  type="range" min={1} max={5} step={0.5} value={drawWidth}
                  onChange={e => setDrawWidth(parseFloat(e.target.value))}
                  style={{ flex:1, accentColor:'var(--g0)' }}
                />
                <span style={{ fontSize:10, color:'var(--t3)', fontWeight:700, width:16, textAlign:'right' }}>{drawWidth}</span>
              </div>

              {/* Line style */}
              <div style={{ display:'flex', gap:4 }}>
                {(['solid','dashed','dotted'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setDrawStyle(s)}
                    style={{
                      flex:1, padding:'4px 0', borderRadius:5, fontSize:9, fontWeight:700,
                      border:`1px solid ${drawStyle === s ? 'var(--g0)' : 'var(--border)'}`,
                      background: drawStyle === s ? 'rgba(0,230,118,.1)' : 'transparent',
                      color: drawStyle === s ? 'var(--g0)' : 'var(--t4)', cursor:'pointer', fontFamily:'inherit',
                    }}
                  >{s === 'solid' ? '─' : s === 'dashed' ? '╌' : '┄'}</button>
                ))}
              </div>
            </div>

            {/* Tool groups */}
            <div style={{ maxHeight:260, overflowY:'auto' }}>
              {TOOL_GROUPS.map(group => (
                <div key={group.label}>
                  <div style={{ padding:'6px 12px 3px', fontSize:9, fontWeight:800, color:'var(--t4)', letterSpacing:'.8px', textTransform:'uppercase' }}>
                    {group.label}
                  </div>
                  {group.tools.map(({ id, label, icon }) => {
                    // Cursor (id===null) just exits drawing mode — editing an
                    // existing drawing (dragging a handle, long-press to open
                    // its settings) works automatically as soon as you touch
                    // it, no mode switch required.
                    const isActive = id === null ? drawMode === null : drawMode === id;
                    const color = id ? TOOL_COLORS[id] : 'var(--g0)';
                    return (
                      <button
                        key={label}
                        onClick={() => {
                          if (id === null) setDrawMode(null);
                          else setDrawMode(d => d === id ? null : id);
                        }}
                        style={{
                          display:'flex', alignItems:'center', gap:8, padding:'7px 12px', width:'100%',
                          border:'none', background: isActive ? `${color}15` : 'transparent',
                          color: isActive ? color : 'var(--t3)', fontSize:12, fontWeight:600,
                          cursor:'pointer', fontFamily:'inherit', textAlign:'left',
                          borderLeft: isActive ? `2px solid ${color}` : '2px solid transparent',
                          transition:'all .12s',
                        }}
                      >
                        <span style={{ fontFamily:'monospace', fontSize:14, width:16, textAlign:'center', color: isActive ? color : 'var(--t4)' }}>{icon}</span>
                        {label}
                        {isActive && <span style={{ marginLeft:'auto', fontSize:9, background:color+'30', color, padding:'2px 5px', borderRadius:4 }}>ON</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Clear / actions */}
            {drawings.length > 0 && (
              <div style={{ borderTop:'1px solid var(--border)', padding:'8px 8px' }}>
                <button
                  onClick={() => { setDrawings([]); setSelectedId(null); drawingsRef.current = []; redrawCanvas(); }}
                  style={{
                    width:'100%', padding:'6px', borderRadius:6, border:'1px solid rgba(255,61,87,.3)',
                    background:'rgba(255,61,87,.08)', color:'var(--red)', fontSize:11,
                    fontWeight:700, cursor:'pointer', fontFamily:'inherit',
                  }}
                >
                  🗑 Clear all ({drawings.length})
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Edit drawing dialog ─────────────────────────────────────────── */}
        {editDraw && (
          <div style={{
            position:'absolute', top:'50%', left:'50%', transform:'translate(-50%,-50%)',
            background:'var(--bg1)', border:'1px solid var(--border2)', borderRadius:14,
            padding:16, zIndex:40, minWidth:220, boxShadow:'0 12px 48px rgba(0,0,0,.6)',
          }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
              <div style={{ fontSize:13, fontWeight:800, color:'var(--t1)' }}>Edit {allToolsFlat.find(x => x.id === editDraw.tool)?.label || editDraw.tool}</div>
              <button onClick={() => setEditDraw(null)} style={{ background:'none', border:'none', cursor:'pointer', color:'var(--t4)', fontSize:16 }}>×</button>
            </div>

            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:'var(--t4)', fontWeight:700, letterSpacing:'.5px', marginBottom:6 }}>COLOR</div>
              <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                {DEFAULT_COLORS.map(c => (
                  <div
                    key={c}
                    onClick={() => {
                      setDrawings(prev => prev.map(d => d.id === editDraw.id ? { ...d, color: c } : d));
                      setEditDraw(prev => prev ? { ...prev, color: c } : null);
                    }}
                    style={{ width:22, height:22, borderRadius:6, background:c, cursor:'pointer', border: editDraw.color === c ? '2px solid #fff' : '2px solid transparent' }}
                  />
                ))}
              </div>
            </div>

            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:'var(--t4)', fontWeight:700, letterSpacing:'.5px', marginBottom:6 }}>WIDTH</div>
              <input
                type="range" min={1} max={5} step={0.5} value={editDraw.width}
                onChange={e => {
                  const w = parseFloat(e.target.value);
                  setDrawings(prev => prev.map(d => d.id === editDraw.id ? { ...d, width: w } : d));
                  setEditDraw(prev => prev ? { ...prev, width: w } : null);
                  setTimeout(redrawCanvas, 10);
                }}
                style={{ width:'100%', accentColor:'var(--g0)' }}
              />
            </div>

            <div style={{ display:'flex', gap:6 }}>
              <button
                onClick={() => { setDrawings(prev => prev.filter(d => d.id !== editDraw.id)); setSelectedId(null); setEditDraw(null); }}
                style={{ flex:1, padding:'9px 0', borderRadius:8, border:'1px solid rgba(255,61,87,.3)', background:'rgba(255,61,87,.08)', color:'var(--red)', fontWeight:700, cursor:'pointer', fontSize:12, fontFamily:'inherit' }}
              >Delete</button>
              <button
                onClick={() => setEditDraw(null)}
                style={{ flex:1, padding:'9px 0', borderRadius:8, border:'1px solid var(--border2)', background:'var(--bg2)', color:'var(--t1)', fontWeight:700, cursor:'pointer', fontSize:12, fontFamily:'inherit' }}
              >Close</button>
            </div>
          </div>
        )}

        {loading && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.35)', zIndex:10, pointerEvents:'none' }}>
            <div className="spinner" />
          </div>
        )}
      </div>
    </div>
  );
}
