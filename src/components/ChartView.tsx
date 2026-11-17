import { useEffect, useRef, useState } from 'react'
import {
  CandlestickSeries, CrosshairMode, HistogramSeries, LineSeries, LineStyle, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type MouseEventParams, type SeriesMarker, type Time, type UTCTimestamp,
} from 'lightweight-charts'
import { ArrowRightToLine, SendToBack, Trash2 } from 'lucide-react'
import { activeMeta, getDisplay, lastCandle, useStore } from '../store'
import type { Candle, Drawing, Pt } from '../lib/types'
import { bucketOf, indexAtOrBefore } from '../lib/aggregate'
import { Ema, Rsi } from '../lib/indicators'
import { unrealized } from '../lib/engine'
import { fmtMoney, fmtPrice, fmtQty, fmtR, fmtTime, roundTo, tfLabel, uid } from '../lib/format'
import { C, MONO, SANS } from '../lib/theme'

const EMA_COLORS: Record<number, string> = { 20: '#e8a23a', 50: '#5b9cf5', 200: '#b78cf0' }
const ts = (t: number) => t as UTCTimestamp

type Handle = 'a' | 'b' | 'sl' | 'tp' | 'entry' | 'right' | 'body'
type Level = { owner: 'pos' | 'ord'; id: string; field: 'sl' | 'tp' | 'price'; price: number }
type Drag =
  | { kind: 'drawing'; handle: Handle; orig: Drawing; l0: number; p0: number }
  | { kind: 'level'; level: Level; price: number }
  | { kind: 'draft'; x0: number; y0: number; awaitSecond: boolean }

export function ChartView() {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const emaRef = useRef(new Map<number, { series: ISeriesApi<'Line'>; calc: Ema }>())
  const rsiRef = useRef<{ series: ISeriesApi<'Line'>; calc: Rsi } | null>(null)
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null)
  const linesRef = useRef<IPriceLine[]>([])
  const display = useRef<Candle[]>([])
  const rendered = useRef({ key: '', len: 0, cursor: 0, replay: true })
  const dirty = useRef(true)
  const drag = useRef<Drag | null>(null)
  const draft = useRef<Drawing | null>(null)
  const intercept = useRef(false)

  const ready = useStore((s) => s.ready)
  const activeId = useStore((s) => s.activeId)
  const tf = useStore((s) => s.tf)
  const cursor = useStore((s) => s.cursor)
  const replay = useStore((s) => s.replay)
  const indicators = useStore((s) => s.indicators)
  const tool = useStore((s) => s.tool)
  const drawings = useStore((s) => s.drawings[s.activeId])
  const selected = useStore((s) => s.selectedDrawing)
  const positions = useStore((s) => s.positions)
  const orders = useStore((s) => s.orders)
  const trades = useStore((s) => s.trades)
  const currency = useStore((s) => s.account.currency)
  const meta = useStore((s) => activeMeta(s))
  const [hover, setHover] = useState<Candle | null>(null)

  // Latest values for the imperative pointer / paint code.
  const live = useRef({ tool, drawings: drawings ?? [], selected, positions, orders, tf, decimals: meta?.decimals ?? 2 })
  live.current = { tool, drawings: drawings ?? [], selected, positions, orders, tf, decimals: meta?.decimals ?? 2 }
  dirty.current = true

  // ───── coordinate helpers (time <-> x goes through bar index so gaps in the data are handled) ─────
  const logicalOf = (t: number): number => {
    const d = display.current
    if (!d.length) return 0
    const i = indexAtOrBefore(d, t)
    const step = live.current.tf
    if (i < 0) return (t - d[0].time) / step
    if (i >= d.length - 1) return i + (t - d[i].time) / step
    return i + (t - d[i].time) / (d[i + 1].time - d[i].time)
  }
  const timeAt = (logical: number): number => {
    const d = display.current
    if (!d.length) return 0
    const l = Math.round(logical)
    const step = live.current.tf
    if (l < 0) return d[0].time + l * step
    if (l > d.length - 1) return d[d.length - 1].time + (l - (d.length - 1)) * step
    return d[l].time
  }
  // logicalToCoordinate only accepts whole bar indices, so interpolate between neighbours.
  const xOf = (t: number): number | null => {
    const scale = chartRef.current?.timeScale()
    if (!scale) return null
    const l = logicalOf(t)
    const f = Math.floor(l)
    const x0 = scale.logicalToCoordinate(f as never)
    if (x0 == null) return null
    if (l === f) return x0
    const x1 = scale.logicalToCoordinate((f + 1) as never)
    return x1 == null ? x0 : x0 + (x1 - x0) * (l - f)
  }
  const yOf = (p: number) => candleRef.current?.priceToCoordinate(p) ?? null
  const priceAt = (y: number) => candleRef.current?.coordinateToPrice(y) ?? null
  const logicalAt = (x: number) => chartRef.current?.timeScale().coordinateToLogical(x) ?? null
  const paneSize = () => {
    try {
      return chartRef.current!.paneSize(0)
    } catch {
      return { width: 0, height: 0 }
    }
  }

  // ───── chart setup ─────
  useEffect(() => {
    const el = wrap.current!
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: C.bg }, textColor: C.muted, fontFamily: SANS, fontSize: 11, attributionLogo: false, panes: { separatorColor: C.line, separatorHoverColor: '#2d3643' } },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#4a5462', labelBackgroundColor: '#2a323d' }, horzLine: { color: '#4a5462', labelBackgroundColor: '#2a323d' } },
      rightPriceScale: { borderColor: C.line },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, rightOffset: 6, minBarSpacing: 1.5 },
      localization: { timeFormatter: (t: number) => fmtTime(t) },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down,
      priceLineColor: '#55606e', priceLineStyle: LineStyle.Dotted,
    })
    chartRef.current = chart
    candleRef.current = series
    markersRef.current = createSeriesMarkers(series, [])

    const onMove = (p: MouseEventParams) => {
      const bar = p.time != null ? (p.seriesData.get(series) as { open: number; high: number; low: number; close: number } | undefined) : undefined
      setHover(bar ? { time: p.time as number, ...bar, volume: 0 } : null)
    }
    const onClick = (p: MouseEventParams) => {
      const s = useStore.getState()
      if (s.tool === 'cut' && p.time != null) s.cutAt(p.time as number)
    }
    chart.subscribeCrosshairMove(onMove)
    chart.subscribeClick(onClick)
    return () => {
      chart.remove()
      chartRef.current = null
      candleRef.current = null
      emaRef.current.clear()
      rsiRef.current = null
      volRef.current = null
      linesRef.current = []
      rendered.current = { key: '', len: 0, cursor: 0, replay: true }
    }
  }, [])

  // ───── candles + indicators ─────
  useEffect(() => {
    const chart = chartRef.current
    const candle = candleRef.current
    if (!ready || !chart || !candle || !meta) return
    const d = getDisplay()
    display.current = d
    const key = `${activeId}|${tf}`
    const r = rendered.current

    // create / remove indicator series to match the toggles
    let structural = false
    for (const period of [20, 50, 200]) {
      const on = indicators[`ema${period}` as 'ema20']
      const has = emaRef.current.get(period)
      if (on && !has) {
        const s = chart.addSeries(LineSeries, { color: EMA_COLORS[period], lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })
        emaRef.current.set(period, { series: s, calc: new Ema(period) })
        structural = true
      } else if (!on && has) {
        chart.removeSeries(has.series)
        emaRef.current.delete(period)
      }
    }
    if (indicators.volume && !volRef.current) {
      volRef.current = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false })
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } })
      structural = true
    } else if (!indicators.volume && volRef.current) {
      chart.removeSeries(volRef.current)
      volRef.current = null
    }
    candle.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: indicators.volume ? 0.2 : 0.06 } })
    if (indicators.rsi && !rsiRef.current) {
      const s = chart.addSeries(LineSeries, { color: '#b78cf0', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, priceFormat: { type: 'price', precision: 1, minMove: 0.1 } }, 1)
      s.createPriceLine({ price: 70, color: '#4a5462', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' })
      s.createPriceLine({ price: 30, color: '#4a5462', lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: '' })
      rsiRef.current = { series: s, calc: new Rsi(14) }
      chart.panes()[1]?.setHeight(Math.max(80, Math.round((wrap.current?.clientHeight ?? 500) * 0.2)))
      structural = true
    } else if (!indicators.rsi && rsiRef.current) {
      chart.removeSeries(rsiRef.current.series)
      rsiRef.current = null
    }

    const incremental = !structural && r.key === key && r.replay === replay && r.len > 0 && d.length >= r.len && cursor > r.cursor
    const from = incremental ? r.len - 1 : 0
    const volBar = (c: Candle) => ({ time: ts(c.time), value: c.volume, color: c.close >= c.open ? 'rgba(47,191,138,.38)' : 'rgba(229,72,77,.38)' })
    const bar = (c: Candle) => ({ time: ts(c.time), open: c.open, high: c.high, low: c.low, close: c.close })

    emaRef.current.forEach((e) => e.calc.update(d, from))
    rsiRef.current?.calc.update(d, from)

    if (incremental) {
      for (let i = from; i < d.length; i++) {
        candle.update(bar(d[i]))
        volRef.current?.update(volBar(d[i]))
        emaRef.current.forEach((e) => e.calc.ready(i) && e.series.update({ time: ts(d[i].time), value: e.calc.values[i] }))
        const rv = rsiRef.current?.calc.values[i]
        if (rv != null && !isNaN(rv)) rsiRef.current!.series.update({ time: ts(d[i].time), value: rv })
      }
    } else {
      candle.applyOptions({ priceFormat: { type: 'price', precision: meta.decimals, minMove: 1 / 10 ** meta.decimals } })
      candle.setData(d.map(bar))
      volRef.current?.setData(d.map(volBar))
      emaRef.current.forEach((e) => {
        const out = []
        for (let i = e.calc.period - 1; i < d.length; i++) out.push({ time: ts(d[i].time), value: e.calc.values[i] })
        e.series.setData(out)
      })
      if (rsiRef.current) {
        const out = []
        const v = rsiRef.current.calc.values
        for (let i = 0; i < d.length; i++) if (!isNaN(v[i])) out.push({ time: ts(d[i].time), value: v[i] })
        rsiRef.current.series.setData(out)
      }
      const scale = chart.timeScale()
      const vr = scale.getVisibleLogicalRange()
      const lastIdx = d.length - 1
      if (r.key !== key || !vr) {
        const bars = Math.max(40, Math.round((wrap.current?.clientWidth ?? 800) / 9))
        scale.setVisibleLogicalRange({ from: d.length - bars, to: d.length + 6 })
      } else if (lastIdx > vr.to || lastIdx < vr.from) {
        const w = vr.to - vr.from
        scale.setVisibleLogicalRange({ from: d.length - w * 0.85, to: d.length + w * 0.15 })
      }
    }
    rendered.current = { key, len: d.length, cursor, replay }
    dirty.current = true
  }, [ready, activeId, tf, cursor, replay, indicators, meta])

  // ───── order / position lines and trade markers ─────
  useEffect(() => {
    const series = candleRef.current
    if (!series || !meta) return
    for (const l of linesRef.current) series.removePriceLine(l)
    const lines: IPriceLine[] = []
    const last = lastCandle()
    const add = (price: number, color: string, title: string, style = LineStyle.Solid) =>
      lines.push(series.createPriceLine({ price, color, title, lineStyle: style, lineWidth: 1, axisLabelVisible: true }))
    for (const p of positions) {
      const pnl = last ? unrealized(p, last.close) : 0
      const r = p.riskAmount > 0 ? ` ${fmtR(pnl / p.riskAmount)}` : ''
      add(p.entry, C.amber, `${p.dir === 1 ? 'LONG' : 'SHORT'} ${fmtQty(p.qty)} · ${fmtMoney(pnl, currency, true)}${r}`)
      if (p.sl != null) add(p.sl, C.down, 'SL', LineStyle.Dashed)
      if (p.tp != null) add(p.tp, C.up, 'TP', LineStyle.Dashed)
    }
    for (const o of orders) {
      add(o.price, C.blue, `${o.dir === 1 ? 'BUY' : 'SELL'} ${o.type.toUpperCase()} ${fmtQty(o.qty)}`, LineStyle.LargeDashed)
      if (o.sl != null) add(o.sl, C.down, 'SL', LineStyle.Dotted)
      if (o.tp != null) add(o.tp, C.up, 'TP', LineStyle.Dotted)
    }
    linesRef.current = lines

    // Markers for closed trades — only those that happened at or before the replay cursor.
    const now = last?.time ?? 0
    const marks: SeriesMarker<Time>[] = []
    for (const t of trades) {
      if (t.datasetId !== activeId || t.exitTime > now) continue
      marks.push({ time: ts(bucketOf(t.entryTime, tf)), position: t.dir === 1 ? 'belowBar' : 'aboveBar', shape: t.dir === 1 ? 'arrowUp' : 'arrowDown', color: C.amber, size: 1 })
      marks.push({ time: ts(bucketOf(t.exitTime, tf)), position: t.dir === 1 ? 'aboveBar' : 'belowBar', shape: 'circle', color: t.pnl >= 0 ? C.up : C.down, size: 0.6 })
    }
    for (const p of positions) marks.push({ time: ts(bucketOf(p.entryTime, tf)), position: p.dir === 1 ? 'belowBar' : 'aboveBar', shape: p.dir === 1 ? 'arrowUp' : 'arrowDown', color: C.amber, size: 1 })
    marks.sort((a, b) => (a.time as number) - (b.time as number))
    markersRef.current?.setMarkers(marks)
  }, [positions, orders, trades, cursor, tf, activeId, currency, meta, replay])

  // ───── overlay painting ─────
  useEffect(() => {
    let raf = 0
    let sig = ''
    const paint = () => {
      raf = requestAnimationFrame(paint)
      const cv = canvas.current
      const chart = chartRef.current
      const el = wrap.current
      if (!cv || !chart || !el) return
      const w = el.clientWidth
      const h = el.clientHeight
      const vr = chart.timeScale().getVisibleLogicalRange()
      const next = `${w}|${h}|${vr?.from}|${vr?.to}|${yOf(1)}|${yOf(2)}`
      if (next === sig && !dirty.current) return
      sig = next
      dirty.current = false
      const dpr = window.devicePixelRatio || 1
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr)
        cv.height = Math.round(h * dpr)
      }
      const g = cv.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const pane = paneSize()
      g.save()
      g.beginPath()
      g.rect(0, 0, pane.width, pane.height)
      g.clip()
      const L = live.current
      for (const d of L.drawings) if (d.id !== draft.current?.id) drawOne(g, d, d.id === L.selected, pane.width)
      if (draft.current) drawOne(g, draft.current, true, pane.width)
      const dr = drag.current
      if (dr?.kind === 'level') {
        const y = yOf(dr.price)
        if (y != null) {
          g.strokeStyle = dr.level.field === 'tp' ? C.up : dr.level.field === 'sl' ? C.down : C.blue
          g.lineWidth = 1.5
          g.setLineDash([6, 4])
          line(g, 0, y, pane.width, y)
          g.setLineDash([])
          label(g, `${dr.level.field.toUpperCase()} → ${fmtPrice(dr.price, L.decimals)}`, pane.width - 8, y - 6, g.strokeStyle as string, 'right')
        }
      }
      g.restore()
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const line = (g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) => {
    g.beginPath()
    g.moveTo(x1, y1)
    g.lineTo(x2, y2)
    g.stroke()
  }
  const label = (g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: CanvasTextAlign = 'left') => {
    g.font = `500 11px ${MONO}`
    g.textAlign = align
    g.textBaseline = 'middle'
    const tw = g.measureText(text).width
    const bx = align === 'right' ? x - tw - 5 : align === 'center' ? x - tw / 2 - 5 : x - 5
    g.fillStyle = 'rgba(13,16,20,.82)'
    g.fillRect(bx, y - 9, tw + 10, 18)
    g.fillStyle = color
    g.fillText(text, x, y + 0.5)
  }
  const dot = (g: CanvasRenderingContext2D, x: number, y: number, color: string) => {
    g.beginPath()
    g.arc(x, y, 4.5, 0, Math.PI * 2)
    g.fillStyle = C.bg
    g.fill()
    g.strokeStyle = color
    g.lineWidth = 1.5
    g.stroke()
  }

  function drawOne(g: CanvasRenderingContext2D, d: Drawing, sel: boolean, width: number) {
    const dec = live.current.decimals
    g.lineWidth = sel ? 1.75 : 1.25
    g.setLineDash([])
    if (d.kind === 'hline') {
      const y = yOf(d.p)
      if (y == null) return
      g.strokeStyle = C.blue
      line(g, 0, y, width, y)
      label(g, fmtPrice(d.p, dec), 8, y - 11, C.blue)
      if (sel) dot(g, width / 2, y, C.blue)
      return
    }
    if ('a' in d) {
      const x1 = xOf(d.a.t), y1 = yOf(d.a.p), x2 = xOf(d.b.t), y2 = yOf(d.b.p)
      if (x1 == null || y1 == null || x2 == null || y2 == null) return
      if (d.kind === 'rect') {
        g.fillStyle = 'rgba(91,156,245,.11)'
        g.strokeStyle = 'rgba(91,156,245,.75)'
        g.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
        g.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
      } else {
        g.strokeStyle = C.blue
        let ex: number = x2, ey: number = y2
        if (d.kind === 'ray' && (x2 !== x1 || y2 !== y1)) {
          const k = 4000 / Math.max(1, Math.hypot(x2 - x1, y2 - y1))
          ex = x1 + (x2 - x1) * k
          ey = y1 + (y2 - y1) * k
        }
        line(g, x1, y1, ex, ey)
      }
      if (sel) {
        dot(g, x1, y1, C.blue)
        dot(g, x2, y2, C.blue)
      }
      return
    }
    // long / short position tool
    const x1 = xOf(d.t1), x2 = xOf(d.t2), ye = yOf(d.entry), ys = yOf(d.sl), yt = yOf(d.tp)
    if (x1 == null || x2 == null || ye == null || ys == null || yt == null) return
    const left = Math.min(x1, x2), wd = Math.abs(x2 - x1)
    g.fillStyle = 'rgba(229,72,77,.16)'
    g.fillRect(left, Math.min(ye, ys), wd, Math.abs(ys - ye))
    g.fillStyle = 'rgba(47,191,138,.16)'
    g.fillRect(left, Math.min(ye, yt), wd, Math.abs(yt - ye))
    g.strokeStyle = C.down
    line(g, left, ys, left + wd, ys)
    g.strokeStyle = C.up
    line(g, left, yt, left + wd, yt)
    g.strokeStyle = '#aab3bf'
    line(g, left, ye, left + wd, ye)
    const risk = Math.abs(d.entry - d.sl)
    const reward = Math.abs(d.tp - d.entry)
    const rr = risk > 0 ? reward / risk : 0
    const pct = (v: number) => `${((Math.abs(v - d.entry) / d.entry) * 100).toFixed(2)}%`
    const mid = left + wd / 2
    const up = yt < ye
    label(g, `TP ${fmtPrice(d.tp, dec)}  +${pct(d.tp)}`, mid, yt + (up ? -12 : 12), C.up, 'center')
    label(g, `SL ${fmtPrice(d.sl, dec)}  −${pct(d.sl)}`, mid, ys + (up ? 12 : -12), C.down, 'center')
    label(g, `${d.kind === 'long' ? 'LONG' : 'SHORT'}  R:R 1 : ${rr.toFixed(2)}`, mid, ye, C.text, 'center')
    if (sel) {
      dot(g, mid, ys, C.down)
      dot(g, mid, yt, C.up)
      dot(g, left, ye, '#aab3bf')
      dot(g, left + wd, ye, '#aab3bf')
    }
  }

  // ───── pointer interaction: drawing, dragging drawings, dragging SL / TP / order lines ─────
  useEffect(() => {
    const el = wrap.current!
    const pos = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const near = (ax: number, ay: number, bx: number, by: number, tol: number) => Math.hypot(ax - bx, ay - by) <= tol
    const segDist = (px: number, py: number, x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1, dy = y2 - y1
      const len2 = dx * dx + dy * dy
      const t = len2 ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2)) : 0
      return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t))
    }

    const hitDrawing = (d: Drawing, x: number, y: number, tol: number, handles: boolean): Handle | null => {
      const width = paneSize().width
      if (d.kind === 'hline') {
        const yy = yOf(d.p)
        return yy != null && Math.abs(y - yy) <= tol ? 'body' : null
      }
      if ('a' in d) {
        const x1 = xOf(d.a.t), y1 = yOf(d.a.p), x2 = xOf(d.b.t), y2 = yOf(d.b.p)
        if (x1 == null || y1 == null || x2 == null || y2 == null) return null
        if (handles && near(x, y, x1, y1, tol + 3)) return 'a'
        if (handles && near(x, y, x2, y2, tol + 3)) return 'b'
        if (d.kind === 'rect') return x >= Math.min(x1, x2) - tol && x <= Math.max(x1, x2) + tol && y >= Math.min(y1, y2) - tol && y <= Math.max(y1, y2) + tol ? 'body' : null
        let ex: number = x2, ey: number = y2
        if (d.kind === 'ray') {
          const k = (width * 4) / Math.max(1, Math.hypot(x2 - x1, y2 - y1))
          ex = x1 + (x2 - x1) * k
          ey = y1 + (y2 - y1) * k
        }
        return segDist(x, y, x1, y1, ex, ey) <= tol ? 'body' : null
      }
      const x1 = xOf(d.t1), x2 = xOf(d.t2), ye = yOf(d.entry), ys = yOf(d.sl), yt = yOf(d.tp)
      if (x1 == null || x2 == null || ye == null || ys == null || yt == null) return null
      const left = Math.min(x1, x2), right = Math.max(x1, x2), mid = (left + right) / 2
      if (handles) {
        if (near(x, y, mid, ys, tol + 4)) return 'sl'
        if (near(x, y, mid, yt, tol + 4)) return 'tp'
        if (near(x, y, right, ye, tol + 4)) return 'right'
        if (near(x, y, left, ye, tol + 4)) return 'entry'
      }
      return x >= left && x <= right && y >= Math.min(ys, yt) && y <= Math.max(ys, yt) ? 'body' : null
    }

    const hitLevel = (y: number, tol: number): Level | null => {
      const L = live.current
      const cands: Level[] = []
      for (const p of L.positions) {
        if (p.sl != null) cands.push({ owner: 'pos', id: p.id, field: 'sl', price: p.sl })
        if (p.tp != null) cands.push({ owner: 'pos', id: p.id, field: 'tp', price: p.tp })
      }
      for (const o of L.orders) {
        cands.push({ owner: 'ord', id: o.id, field: 'price', price: o.price })
        if (o.sl != null) cands.push({ owner: 'ord', id: o.id, field: 'sl', price: o.sl })
        if (o.tp != null) cands.push({ owner: 'ord', id: o.id, field: 'tp', price: o.tp })
      }
      let best: Level | null = null
      let bestD = tol
      for (const c of cands) {
        const yy = yOf(c.price)
        if (yy != null && Math.abs(yy - y) <= bestD) {
          best = c
          bestD = Math.abs(yy - y)
        }
      }
      return best
    }

    const pointAt = (x: number, y: number): Pt | null => {
      const l = logicalAt(x)
      const p = priceAt(y)
      return l == null || p == null ? null : { t: timeAt(l), p }
    }

    const beginDraft = (x: number, y: number) => {
      const pt = pointAt(x, y)
      const L = live.current
      if (!pt) return
      const store = useStore.getState()
      if (L.tool === 'hline') return store.addDrawing({ id: uid(), kind: 'hline', p: pt.p })
      if (L.tool === 'long' || L.tool === 'short') {
        const top = priceAt(0), bottom = priceAt(paneSize().height)
        const span = top != null && bottom != null ? Math.abs(top - bottom) : pt.p * 0.02
        const risk = span * 0.07
        const sign = L.tool === 'long' ? 1 : -1
        const l = logicalAt(x) ?? 0
        const vr = chartRef.current?.timeScale().getVisibleLogicalRange()
        const bars = Math.max(6, Math.round(((vr?.to ?? 100) - (vr?.from ?? 0)) * 0.16))
        return store.addDrawing({ id: uid(), kind: L.tool, t1: pt.t, t2: timeAt(l + bars), entry: pt.p, sl: pt.p - sign * risk, tp: pt.p + sign * risk * 2 })
      }
      if (L.tool === 'trend' || L.tool === 'ray' || L.tool === 'rect') {
        draft.current = { id: uid(), kind: L.tool, a: pt, b: pt }
        drag.current = { kind: 'draft', x0: x, y0: y, awaitSecond: false }
        dirty.current = true
      }
    }

    const commitDraft = () => {
      const d = draft.current
      draft.current = null
      drag.current = null
      dirty.current = true
      if (d && d.kind !== 'hline' && 'a' in d && (d.a.t !== d.b.t || d.a.p !== d.b.p)) useStore.getState().addDrawing(d)
    }

    const onDown = (e: PointerEvent) => {
      intercept.current = false
      if (e.button > 0) return
      const { x, y } = pos(e)
      const pane = paneSize()
      if (x > pane.width || y > pane.height) return // price / time axes and the RSI pane belong to the chart
      const L = live.current
      const tol = e.pointerType === 'touch' ? 16 : 8

      if (L.tool !== 'cursor' && L.tool !== 'cut') {
        intercept.current = true
        if (drag.current?.kind === 'draft' && drag.current.awaitSecond) {
          const pt = pointAt(x, y)
          if (pt && draft.current && 'b' in draft.current) draft.current = { ...draft.current, b: pt }
          return commitDraft()
        }
        return beginDraft(x, y)
      }
      if (L.tool === 'cut') return

      const level = hitLevel(y, tol)
      if (level) {
        intercept.current = true
        drag.current = { kind: 'level', level, price: level.price }
        return
      }
      const start = (d: Drawing, handle: Handle) => {
        intercept.current = true
        drag.current = { kind: 'drawing', handle, orig: d, l0: logicalAt(x) ?? 0, p0: priceAt(y) ?? 0 }
        if (L.selected !== d.id) useStore.setState({ selectedDrawing: d.id })
      }
      const sel = L.drawings.find((d) => d.id === L.selected)
      if (sel) {
        const h = hitDrawing(sel, x, y, tol, true)
        if (h) return start(sel, h)
      }
      for (let i = L.drawings.length - 1; i >= 0; i--) {
        const h = hitDrawing(L.drawings[i], x, y, tol, false)
        if (h) return start(L.drawings[i], h)
      }
      if (L.selected) useStore.setState({ selectedDrawing: null })
    }

    const onMove = (e: PointerEvent) => {
      const dr = drag.current
      if (!dr) return
      const { x, y } = pos(e)
      dirty.current = true
      if (dr.kind === 'draft') {
        const pt = pointAt(x, y)
        if (pt && draft.current && 'b' in draft.current) draft.current = { ...draft.current, b: pt }
        return
      }
      const price = priceAt(y)
      if (price == null) return
      if (dr.kind === 'level') {
        dr.price = price
        return
      }
      const o = dr.orig
      const dp = price - dr.p0
      const dl = Math.round((logicalAt(x) ?? dr.l0) - dr.l0)
      const shift = (t: number) => timeAt(Math.round(logicalOf(t)) + dl)
      const here = pointAt(x, y)
      let n: Drawing = o
      if (o.kind === 'hline') n = { ...o, p: o.p + dp }
      else if ('a' in o) {
        if (dr.handle === 'a' && here) n = { ...o, a: here }
        else if (dr.handle === 'b' && here) n = { ...o, b: here }
        else n = { ...o, a: { t: shift(o.a.t), p: o.a.p + dp }, b: { t: shift(o.b.t), p: o.b.p + dp } }
      } else {
        const sign = o.kind === 'long' ? 1 : -1
        const minGap = Math.abs(o.entry) * 1e-5
        if (dr.handle === 'sl') n = { ...o, sl: sign === 1 ? Math.min(price, o.entry - minGap) : Math.max(price, o.entry + minGap) }
        else if (dr.handle === 'tp') n = { ...o, tp: sign === 1 ? Math.max(price, o.entry + minGap) : Math.min(price, o.entry - minGap) }
        else if (dr.handle === 'right' && here) n = { ...o, t2: here.t }
        else if (dr.handle === 'entry') n = { ...o, entry: sign === 1 ? Math.min(Math.max(price, o.sl + minGap), o.tp - minGap) : Math.max(Math.min(price, o.sl - minGap), o.tp + minGap) }
        else n = { ...o, t1: shift(o.t1), t2: shift(o.t2), entry: o.entry + dp, sl: o.sl + dp, tp: o.tp + dp }
      }
      useStore.getState().updateDrawing(n)
    }

    const onUp = (e: PointerEvent) => {
      const dr = drag.current
      if (!dr) return
      const { x, y } = pos(e)
      if (dr.kind === 'draft') {
        if (Math.hypot(x - dr.x0, y - dr.y0) > 8) return commitDraft() // press-drag-release
        dr.awaitSecond = true // a click: wait for the second click
        return
      }
      drag.current = null
      dirty.current = true
      if (dr.kind === 'level') {
        const s = useStore.getState()
        const lv = dr.level
        const price = roundTo(priceAt(y) ?? dr.price, live.current.decimals)
        if (price === lv.price) return
        const err = lv.owner === 'pos' ? s.modifyPosition(lv.id, { [lv.field]: price }) : s.modifyOrder(lv.id, { [lv.field]: price })
        if (err) s.notify(err, 'bad')
      }
    }

    // lightweight-charts listens to mouse/touch events; swallow them while we own the gesture.
    const swallow = (e: Event) => {
      if (!intercept.current) return
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && draft.current) {
        draft.current = null
        drag.current = null
        dirty.current = true
      }
    }
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('mousedown', swallow, true)
    el.addEventListener('touchstart', swallow, { capture: true, passive: false })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('mousedown', swallow, true)
      el.removeEventListener('touchstart', swallow, true)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // abandon a half-made drawing when the tool changes
  useEffect(() => {
    draft.current = null
    if (drag.current?.kind === 'draft') drag.current = null
    dirty.current = true
  }, [tool, activeId])

  const shown = hover ?? display.current[display.current.length - 1]
  const dec = meta?.decimals ?? 2
  const sel = (drawings ?? []).find((d) => d.id === selected)
  const change = shown ? ((shown.close - shown.open) / shown.open) * 100 : 0
  const toneCls = shown && shown.close >= shown.open ? 'text-up' : 'text-down'

  const sendToTicket = () => {
    if (!sel || (sel.kind !== 'long' && sel.kind !== 'short')) return
    useStore.setState({ ticketDraft: { dir: sel.kind === 'long' ? 1 : -1, entry: sel.entry, sl: sel.sl, tp: sel.tp, nonce: Date.now() }, panelTab: 'trade', panelOpen: true })
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <div ref={wrap} className="absolute inset-0 isolate touch-none" style={{ cursor: tool === 'cursor' ? undefined : 'crosshair' }} />
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/* legend */}
      <div className="pointer-events-none absolute left-3 top-2 right-16 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px]">
        <span className="hidden text-[13px] font-semibold text-ink md:inline">{meta?.symbol}</span>
        <span className="hidden text-muted md:inline">{tfLabel(tf)}</span>
        {shown && (
          <span className="num flex flex-wrap gap-x-2.5 text-muted">
            <span className="hidden md:inline">O <b className={toneCls}>{fmtPrice(shown.open, dec)}</b></span>
            <span className="hidden md:inline">H <b className={toneCls}>{fmtPrice(shown.high, dec)}</b></span>
            <span className="hidden md:inline">L <b className={toneCls}>{fmtPrice(shown.low, dec)}</b></span>
            <span>C <b className={toneCls}>{fmtPrice(shown.close, dec)}</b></span>
            <b className={toneCls}>{change >= 0 ? '+' : '−'}{Math.abs(change).toFixed(2)}%</b>
          </span>
        )}
        <span className="flex gap-2">
          {([20, 50, 200] as const).filter((p) => indicators[`ema${p}`]).map((p) => (
            <span key={p} style={{ color: EMA_COLORS[p] }}>EMA {p}</span>
          ))}
        </span>
      </div>

      {tool === 'cut' && (
        <div className="pointer-events-none absolute left-1/2 top-10 -translate-x-1/2 rounded-md border border-amber/40 bg-panel px-3 py-1.5 text-xs text-amber shadow-lg">
          Tap a candle — everything after it will be hidden
        </div>
      )}
      {!replay && tool !== 'cut' && (
        <div className="pointer-events-none absolute left-1/2 top-10 -translate-x-1/2 rounded-md border border-line bg-panel px-3 py-1.5 text-center text-xs text-muted shadow-lg">
          Full history is visible. Pick a start point with <b className="text-ink">Cut</b>, <b className="text-ink">Jump</b> or <b className="text-ink">Random</b> to begin a replay.
        </div>
      )}

      {sel && (
        <div className="absolute left-1/2 top-10 flex -translate-x-1/2 items-center gap-1 rounded-md border border-line bg-panel p-1 text-xs shadow-lg">
          <span className="px-2 text-muted">{DRAWING_NAMES[sel.kind]}</span>
          {(sel.kind === 'long' || sel.kind === 'short') && (
            <button className="btn-ghost h-7 gap-1.5 px-2 text-amber" onClick={sendToTicket}><SendToBack size={14} /> Use in order ticket</button>
          )}
          <button className="btn-ghost h-7 w-7 text-down" title="Delete (Del)" onClick={() => useStore.getState().removeDrawing(sel.id)}><Trash2 size={14} /></button>
        </div>
      )}

      <button
        className="absolute bottom-9 right-[68px] grid h-7 w-7 place-items-center rounded-md border border-line bg-panel/90 text-muted hover:text-ink"
        title="Scroll to the latest candle"
        onClick={() => chartRef.current?.timeScale().scrollToRealTime()}
      >
        <ArrowRightToLine size={14} />
      </button>
    </div>
  )
}

const DRAWING_NAMES: Record<Drawing['kind'], string> = { hline: 'Horizontal line', trend: 'Trendline', ray: 'Ray', rect: 'Zone', long: 'Long position', short: 'Short position' }
