import type { Candle, DatasetMeta } from './types'

/**
 * Built-in practice datasets.
 *
 * These are SYNTHETIC series, generated deterministically from a seed so the app
 * works offline with zero bundle weight. They model volatility clustering, trend
 * regimes, fat tails, session gaps and per-market trading hours — good for
 * practising execution, not for studying a real instrument's history.
 * Real candles come from the Binance fetcher or the CSV importer.
 */

interface Spec {
  id: string
  symbol: string
  name: string
  seed: number
  startPrice: number
  /** per-15m-bar return sigma */
  sigma: number
  days: number
  tick: number
  decimals: number
  lotSize: number
  spread: number
  volBase: number
  /** is the market open for the bar starting at this unix time? */
  open: (t: number) => boolean
}

const BASE_TF = 900
const END = Date.UTC(2026, 9, 31) / 1000

const always = () => true
const fxHours = (t: number) => {
  const d = new Date(t * 1000)
  const day = d.getUTCDay()
  const h = d.getUTCHours()
  if (day === 6) return false
  if (day === 5 && h >= 22) return false
  if (day === 0 && h < 22) return false
  return true
}
const goldHours = (t: number) => fxHours(t) && new Date(t * 1000).getUTCHours() !== 21
// IDX regular session ≈ 09:00–16:00 WIB = 02:00–09:00 UTC, Mon–Fri
const idxHours = (t: number) => {
  const d = new Date(t * 1000)
  const day = d.getUTCDay()
  const h = d.getUTCHours()
  return day >= 1 && day <= 5 && h >= 2 && h < 9
}

const SPECS: Spec[] = [
  { id: 'sample-btcusdt', symbol: 'BTC/USDT', name: 'Bitcoin · sample', seed: 11, startPrice: 61250, sigma: 0.0021, days: 210, tick: 0.01, decimals: 2, lotSize: 1, spread: 4, volBase: 180, open: always },
  { id: 'sample-xauusd', symbol: 'XAU/USD', name: 'Gold spot · sample', seed: 23, startPrice: 2485, sigma: 0.00072, days: 240, tick: 0.01, decimals: 2, lotSize: 100, spread: 0.3, volBase: 900, open: goldHours },
  { id: 'sample-eurusd', symbol: 'EUR/USD', name: 'Euro / US Dollar · sample', seed: 37, startPrice: 1.0842, sigma: 0.00034, days: 240, tick: 0.00001, decimals: 5, lotSize: 100000, spread: 0.00012, volBase: 2400, open: fxHours },
  { id: 'sample-bbca', symbol: 'BBCA.JK', name: 'IDX bank stock · sample', seed: 53, startPrice: 9200, sigma: 0.0026, days: 420, tick: 25, decimals: 0, lotSize: 100, spread: 25, volBase: 420000, open: idxHours },
]

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function generate(s: Spec): Candle[] {
  const rnd = mulberry32(s.seed)
  const gauss = () => {
    const u = Math.max(rnd(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
  }
  const snap = (p: number) => Number(Math.max(s.tick, Math.round(p / s.tick) * s.tick).toFixed(s.decimals))
  const out: Candle[] = []
  let price = s.startPrice
  let vol = 1 // volatility multiplier, clusters over time
  let drift = 0
  let regimeLeft = 0
  let prevT = 0
  const SUB = 6

  for (let t = END - s.days * 86400; t < END; t += BASE_TF) {
    if (!s.open(t)) continue
    if (regimeLeft-- <= 0) {
      regimeLeft = 120 + Math.floor(rnd() * 500)
      const r = rnd()
      // ~40% ranging, otherwise trending either way
      drift = r < 0.4 ? 0 : (rnd() - 0.48) * s.sigma * 0.22
    }
    // gap after a session break
    if (prevT && t - prevT > BASE_TF) {
      const hours = (t - prevT) / 3600
      price *= 1 + gauss() * s.sigma * Math.min(4, Math.sqrt(hours) * 0.9)
    }
    const hour = new Date(t * 1000).getUTCHours()
    // busier around London / New York overlap
    const sessionBoost = s.open === idxHours ? (hour === 2 || hour === 8 ? 1.5 : 1) : hour >= 12 && hour <= 16 ? 1.35 : hour >= 7 && hour <= 11 ? 1.15 : 0.85

    const open = snap(price)
    let hi = open
    let lo = open
    let p = open
    let absMove = 0
    for (let i = 0; i < SUB; i++) {
      let shock = gauss()
      if (rnd() < 0.004) shock *= 3.5 // fat tail
      const ret = drift / SUB + (shock * s.sigma * vol * sessionBoost) / Math.sqrt(SUB)
      p *= 1 + ret
      absMove += Math.abs(ret)
      if (p > hi) hi = p
      if (p < lo) lo = p
      vol = Math.min(3.2, Math.max(0.45, vol * 0.985 + 0.015 * (0.6 + Math.abs(shock) * 0.55)))
    }
    const close = snap(p)
    const high = Math.max(snap(hi), open, close)
    const low = Math.min(snap(lo), open, close)
    const volume = Math.round(s.volBase * (0.35 + (absMove / s.sigma) * 0.55) * sessionBoost * (0.6 + rnd() * 0.8))
    out.push({ time: t, open, high, low, close, volume })
    price = close
    prevT = t
  }
  return out
}

export function buildSampleDatasets(): { meta: DatasetMeta; candles: Candle[] }[] {
  return SPECS.map((s) => {
    const candles = generate(s)
    return {
      candles,
      meta: {
        id: s.id,
        symbol: s.symbol,
        name: s.name,
        source: 'sample' as const,
        baseTf: BASE_TF,
        decimals: s.decimals,
        lotSize: s.lotSize,
        spread: s.spread,
        count: candles.length,
        from: candles[0].time,
        to: candles[candles.length - 1].time,
      },
    }
  })
}
