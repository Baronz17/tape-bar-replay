import { useEffect, useRef } from 'react'
import { CandlestickSeries, CrosshairMode, HistogramSeries, LineStyle, createChart, type IChartApi, type ISeriesApi, type MouseEventParams, type UTCTimestamp } from 'lightweight-charts'
import type { Candle } from '../../lib/types'
import type { DrillAnswer, DrillScenario, RrPlan } from '../../drills/types'
import { fmtPrice, fmtTime, roundTo } from '../../lib/format'
import { C, MONO, SANS } from '../../lib/theme'

const GOLD = '#e8a23a'

interface Props {
  scenario: DrillScenario
  /** how many candles are revealed */
  visible: number
  blind: boolean
  locked: boolean
  answer: DrillAnswer
  onAnswer: (a: DrillAnswer) => void
  /** direction used when a new position tool is placed */
  rrDir: 1 | -1
  showSolution: boolean
}

/**
 * Chart for a single drill. Deliberately separate from the replay chart: it shows a
 * fixed candle list, exposes only the one tool the drill needs, and can be locked.
 */
export function DrillChart(props: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const shown = useRef(0)
  const live = useRef(props)
  live.current = props
  const dirty = useRef(true)
  dirty.current = true
  const drag = useRef<'level' | 'entry' | 'sl' | 'tp' | null>(null)
  const intercept = useRef(false)

  const { scenario, visible, blind } = props

  useEffect(() => {
    const el = wrap.current!
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { color: C.bg }, textColor: C.muted, fontFamily: SANS, fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: '#4a5462', labelBackgroundColor: '#2a323d' }, horzLine: { color: '#4a5462', labelBackgroundColor: '#2a323d' } },
      rightPriceScale: { borderColor: C.line, scaleMargins: { top: 0.1, bottom: 0.22 } },
      timeScale: { borderColor: C.line, timeVisible: true, secondsVisible: false, shiftVisibleRangeOnNewBar: false },
      localization: { timeFormatter: (t: number) => fmtTime(t) },
    })
    const series = chart.addSeries(CandlestickSeries, {
      upColor: C.up, downColor: C.down, borderUpColor: C.up, borderDownColor: C.down, wickUpColor: C.up, wickDownColor: C.down,
      priceLineColor: '#55606e', priceLineStyle: LineStyle.Dotted,
      priceFormat: { type: 'price', precision: scenario.decimals, minMove: 1 / 10 ** scenario.decimals },
    })
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } })
    chartRef.current = chart
    seriesRef.current = series
    volRef.current = vol
    shown.current = 0

    // A tap places the level / position tool. Dragging an existing line is handled below.
    const onClick = (p: MouseEventParams) => {
      const L = live.current
      if (L.locked || !p.point) return
      const price = series.coordinateToPrice(p.point.y)
      if (price == null) return
      const dec = L.scenario.decimals
      if (L.scenario.interactionType === 'draw_horizontal_level') L.onAnswer({ level: roundTo(price, dec) })
      if (L.scenario.interactionType === 'place_rr_tool' && !L.answer.rr) {
        const pre = L.scenario.candles.slice(Math.max(0, L.scenario.cutIndex - 14), L.scenario.cutIndex)
        const atr = pre.reduce((a, c) => a + c.high - c.low, 0) / pre.length
        const risk = atr * 1.5
        L.onAnswer({ rr: { dir: L.rrDir, entry: roundTo(price, dec), sl: roundTo(price - L.rrDir * risk, dec), tp: roundTo(price + L.rrDir * risk * 2, dec) } })
      }
    }
    chart.subscribeClick(onClick)
    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      volRef.current = null
    }
    // the parent remounts this component (key) for each scenario
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // candles
  useEffect(() => {
    const chart = chartRef.current
    const series = seriesRef.current
    if (!chart || !series) return
    const bar = (c: Candle) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })
    const vbar = (c: Candle) => ({ time: c.time as UTCTimestamp, value: c.volume, color: c.close >= c.open ? 'rgba(47,191,138,.38)' : 'rgba(229,72,77,.38)' })
    const data = scenario.candles
    if (shown.current > 0 && visible > shown.current) {
      for (let i = shown.current; i < visible; i++) {
        series.update(bar(data[i]))
        volRef.current?.update(vbar(data[i]))
      }
    } else {
      series.setData(data.slice(0, visible).map(bar))
      volRef.current?.setData(data.slice(0, visible).map(vbar))
      // leave empty room on the right for the candles that will be revealed
      // (set after layout: the chart has no width yet on the first pass)
      const fit = () => chartRef.current?.timeScale().setVisibleLogicalRange({ from: -1, to: scenario.cutIndex + scenario.revealCount + 2 })
      fit()
      requestAnimationFrame(() => requestAnimationFrame(fit))
    }
    shown.current = visible
    dirty.current = true
  }, [scenario, visible])

  // blind mode: no dates anywhere on the chart
  useEffect(() => {
    chartRef.current?.applyOptions({
      timeScale: { visible: !blind },
      crosshair: { vertLine: { labelVisible: !blind } },
    })
  }, [blind])

  // overlay
  useEffect(() => {
    let raf = 0
    let sig = ''
    const paint = () => {
      raf = requestAnimationFrame(paint)
      const cv = canvas.current
      const chart = chartRef.current
      const series = seriesRef.current
      const el = wrap.current
      if (!cv || !chart || !series || !el) return
      const w = el.clientWidth
      const h = el.clientHeight
      const vr = chart.timeScale().getVisibleLogicalRange()
      const next = `${w}|${h}|${vr?.from}|${vr?.to}|${series.priceToCoordinate(1)}|${series.priceToCoordinate(2)}`
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
      let pane = { width: 0, height: 0 }
      try {
        pane = chart.paneSize(0)
      } catch {
        return
      }
      const L = live.current
      const sc = L.scenario
      const sol = sc.solution
      const dec = sc.decimals
      const y = (p: number) => series.priceToCoordinate(p)
      g.save()
      g.beginPath()
      g.rect(0, 0, pane.width, pane.height)
      g.clip()

      const hline = (p: number, color: string, dash: number[] = [], width = 1.25) => {
        const yy = y(p)
        if (yy == null) return null
        g.strokeStyle = color
        g.lineWidth = width
        g.setLineDash(dash)
        g.beginPath()
        g.moveTo(0, yy)
        g.lineTo(pane.width, yy)
        g.stroke()
        g.setLineDash([])
        return yy
      }
      const tag = (text: string, x: number, yy: number, color: string, align: CanvasTextAlign = 'left') => {
        g.font = `500 11px ${MONO}`
        g.textAlign = align
        g.textBaseline = 'middle'
        const tw = g.measureText(text).width
        const bx = align === 'right' ? x - tw - 5 : x - 5
        g.fillStyle = 'rgba(13,16,20,.85)'
        g.fillRect(bx, yy - 9, tw + 10, 18)
        g.fillStyle = color
        g.fillText(text, x, yy + 0.5)
      }
      const band = (lo: number, hi: number, fill: string) => {
        const a = y(lo), b = y(hi)
        if (a == null || b == null) return
        g.fillStyle = fill
        g.fillRect(0, Math.min(a, b), pane.width, Math.max(3, Math.abs(a - b)))
      }

      // where the decision was made
      if (L.visible > sc.cutIndex) {
        const scale = chart.timeScale()
        const xa = scale.logicalToCoordinate((sc.cutIndex - 1) as never)
        const xb = scale.logicalToCoordinate(sc.cutIndex as never)
        if (xa != null && xb != null) {
          const x = (xa + xb) / 2
          g.strokeStyle = '#4a5462'
          g.lineWidth = 1
          g.setLineDash([4, 4])
          g.beginPath()
          g.moveTo(x, 0)
          g.lineTo(x, pane.height)
          g.stroke()
          g.setLineDash([])
          tag('your decision', x + 8, 14, C.muted)
        }
      }

      // solution
      if (L.showSolution) {
        if (sol.zone) {
          const { price, tolerancePct } = sol.zone
          band(price * (1 - tolerancePct / 100), price * (1 + tolerancePct / 100), 'rgba(232,162,58,.2)')
          const yy = hline(price, GOLD, [], 1)
          if (yy != null) tag(sc.interactionType === 'place_rr_tool' ? `Entry area ${fmtPrice(price, dec)}` : `Key level ${fmtPrice(price, dec)}`, pane.width - 8, yy - 12, GOLD, 'right')
        }
        if (sol.stopBeyond != null) {
          const yy = hline(sol.stopBeyond, C.blue, [6, 4], 1.5)
          if (yy != null) tag(`Stop must be beyond ${fmtPrice(sol.stopBeyond, dec)}`, pane.width - 8, yy + (sol.direction === 'long' ? 12 : -12), C.blue, 'right')
        }
      }

      // the user's level
      if (L.answer.level != null) {
        const yy = hline(L.answer.level, C.blue, [], 1.75)
        if (yy != null) {
          tag(`Your level ${fmtPrice(L.answer.level, dec)}`, 8, yy - 12, C.blue)
          if (!L.locked) handle(g, pane.width / 2, yy, C.blue)
        }
      }

      // the user's position tool
      const rr = L.answer.rr
      if (rr) {
        const ye = y(rr.entry), ys = y(rr.sl), yt = y(rr.tp)
        if (ye != null && ys != null && yt != null) {
          const x0 = Math.max(0, pane.width * 0.52)
          g.fillStyle = 'rgba(229,72,77,.16)'
          g.fillRect(x0, Math.min(ye, ys), pane.width - x0, Math.abs(ys - ye))
          g.fillStyle = 'rgba(47,191,138,.16)'
          g.fillRect(x0, Math.min(ye, yt), pane.width - x0, Math.abs(yt - ye))
          const seg = (yy: number, color: string) => {
            g.strokeStyle = color
            g.lineWidth = 1.5
            g.beginPath()
            g.moveTo(x0, yy)
            g.lineTo(pane.width, yy)
            g.stroke()
          }
          seg(ys, C.down)
          seg(yt, C.up)
          seg(ye, '#aab3bf')
          const risk = Math.abs(rr.entry - rr.sl)
          const ratio = risk > 0 ? Math.abs(rr.tp - rr.entry) / risk : 0
          const mid = (x0 + pane.width) / 2
          const up = yt < ye
          tag(`TP ${fmtPrice(rr.tp, dec)}`, x0 + 8, yt + (up ? -12 : 12), C.up)
          tag(`SL ${fmtPrice(rr.sl, dec)}`, x0 + 8, ys + (up ? 12 : -12), C.down)
          tag(`${rr.dir === 1 ? 'LONG' : 'SHORT'}  1 : ${ratio.toFixed(2)}`, x0 + 8, ye, C.text)
          if (!L.locked) {
            handle(g, mid, ys, C.down)
            handle(g, mid, yt, C.up)
            handle(g, mid, ye, '#aab3bf')
          }
        }
      }
      g.restore()
    }
    raf = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(raf)
  }, [])

  // dragging the level / the three lines of the position tool
  useEffect(() => {
    const el = wrap.current!
    const yIn = (e: PointerEvent) => e.clientY - el.getBoundingClientRect().top
    const onDown = (e: PointerEvent) => {
      intercept.current = false
      const L = live.current
      const series = seriesRef.current
      const chart = chartRef.current
      if (L.locked || !series || !chart || e.button > 0) return
      const r = el.getBoundingClientRect()
      let pane
      try {
        pane = chart.paneSize(0)
      } catch {
        return
      }
      if (e.clientX - r.left > pane.width || e.clientY - r.top > pane.height) return
      const yy = yIn(e)
      const tol = e.pointerType === 'touch' ? 18 : 9
      const dist = (p: number | undefined) => {
        const c = p == null ? null : series.priceToCoordinate(p)
        return c == null ? Infinity : Math.abs(c - yy)
      }
      let best: typeof drag.current = null
      let bestD = tol
      const consider = (name: NonNullable<typeof drag.current>, p: number | undefined) => {
        const d = dist(p)
        if (d <= bestD) {
          best = name
          bestD = d
        }
      }
      consider('level', L.answer.level)
      if (L.answer.rr) {
        consider('entry', L.answer.rr.entry)
        consider('sl', L.answer.rr.sl)
        consider('tp', L.answer.rr.tp)
      }
      if (best) {
        drag.current = best
        intercept.current = true
      }
    }
    const onMove = (e: PointerEvent) => {
      const which = drag.current
      const series = seriesRef.current
      const L = live.current
      if (!which || !series) return
      const raw = series.coordinateToPrice(yIn(e))
      if (raw == null) return
      const dec = L.scenario.decimals
      const price = roundTo(raw, dec)
      if (which === 'level') return L.onAnswer({ level: price })
      const rr = L.answer.rr
      if (!rr) return
      const gap = Math.max(rr.entry * 1e-4, 1 / 10 ** dec)
      const n: RrPlan = { ...rr }
      // keep stop and target on their own sides of the entry
      if (which === 'sl') n.sl = rr.dir === 1 ? Math.min(price, rr.entry - gap) : Math.max(price, rr.entry + gap)
      if (which === 'tp') n.tp = rr.dir === 1 ? Math.max(price, rr.entry + gap) : Math.min(price, rr.entry - gap)
      if (which === 'entry') n.entry = rr.dir === 1 ? Math.min(Math.max(price, rr.sl + gap), rr.tp - gap) : Math.max(Math.min(price, rr.sl - gap), rr.tp + gap)
      L.onAnswer({ rr: { ...n, sl: roundTo(n.sl, dec), tp: roundTo(n.tp, dec), entry: roundTo(n.entry, dec) } })
    }
    const onUp = () => {
      drag.current = null
    }
    const swallow = (e: Event) => {
      if (!intercept.current) return
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
    }
    el.addEventListener('pointerdown', onDown, true)
    el.addEventListener('mousedown', swallow, true)
    el.addEventListener('touchstart', swallow, { capture: true, passive: false })
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      el.removeEventListener('pointerdown', onDown, true)
      el.removeEventListener('mousedown', swallow, true)
      el.removeEventListener('touchstart', swallow, true)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const tool = !props.locked && scenario.interactionType !== 'multiple_choice'
  return (
    <div className="relative h-full w-full overflow-hidden bg-bg">
      <div ref={wrap} className="absolute inset-0 isolate touch-none" style={{ cursor: tool ? 'crosshair' : undefined }} />
      <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  )
}

function handle(g: CanvasRenderingContext2D, x: number, y: number, color: string) {
  g.beginPath()
  g.arc(x, y, 5, 0, Math.PI * 2)
  g.fillStyle = C.bg
  g.fill()
  g.strokeStyle = color
  g.lineWidth = 1.5
  g.stroke()
}
