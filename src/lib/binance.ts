import type { Candle } from './types'

// The market-data mirror is tried first: api.binance.com is blocked by some ISPs.
const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com']
const INTERVAL: Record<number, string> = { 900: '15m', 3600: '1h', 14400: '4h', 86400: '1d' }
export const MAX_CANDLES = 40000

export async function fetchKlines(
  symbol: string,
  tf: number,
  from: number,
  to: number,
  onProgress?: (loaded: number) => void,
): Promise<Candle[]> {
  const interval = INTERVAL[tf]
  if (!interval) throw new Error('Unsupported interval')
  const out: Candle[] = []
  let start = from * 1000
  const end = to * 1000
  let host = HOSTS[0]

  while (start < end && out.length < MAX_CANDLES) {
    const q = `/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${interval}&startTime=${start}&endTime=${end}&limit=1000`
    let res: Response | null = null
    let lastErr: unknown
    for (const h of host === HOSTS[0] ? HOSTS : [host]) {
      try {
        res = await fetch(h + q)
        host = h
        break
      } catch (e) {
        lastErr = e
      }
    }
    if (!res) throw new Error(`Could not reach Binance (${lastErr instanceof Error ? lastErr.message : 'network error'}). Check your connection.`)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.msg ? `Binance: ${body.msg}` : `Binance returned HTTP ${res.status}`)
    }
    const rows = (await res.json()) as unknown[][]
    if (!rows.length) break
    for (const r of rows) {
      out.push({
        time: Math.floor(Number(r[0]) / 1000),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      })
    }
    onProgress?.(out.length)
    start = Number(rows[rows.length - 1][0]) + tf * 1000
    if (rows.length < 1000) break
  }
  if (!out.length) throw new Error('Binance returned no candles for that pair and date range.')
  return out
}

export function guessDecimals(candles: Candle[]): number {
  const p = candles[candles.length - 1].close
  if (p >= 1000) return 2
  if (p >= 10) return 3
  if (p >= 1) return 4
  if (p >= 0.01) return 5
  return 8
}
