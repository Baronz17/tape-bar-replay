import type { Candle } from './types'

export interface ParsedCsv {
  candles: Candle[]
  baseTf: number
  decimals: number
}

function parseTime(a: string, b?: string): number {
  const raw = a.trim()
  if (/^\d+(\.\d+)?$/.test(raw) && !b) {
    const n = Number(raw)
    if (n > 1e11) return Math.floor(n / 1000) // milliseconds
    if (n > 1e8) return Math.floor(n) // seconds
  }
  // MT4/MT5 dates look like 2024.01.31
  let date = raw.replace(/^(\d{4})[./](\d{1,2})[./](\d{1,2})/, (_, y, m, d) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`)
  let time = b?.trim()
  if (!time && date.includes(' ')) [date, time] = date.split(/\s+/, 2)
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const tm = time && /^\d{1,2}:\d{2}/.test(time) ? time : '00:00'
    const ms = Date.parse(`${date}T${tm.length === 4 ? '0' + tm : tm}Z`)
    if (!isNaN(ms)) return Math.floor(ms / 1000)
  }
  const ms = Date.parse(raw)
  return isNaN(ms) ? NaN : Math.floor(ms / 1000)
}

const countDecimals = (s: string) => {
  const i = s.indexOf('.')
  return i < 0 ? 0 : s.length - i - 1
}

/**
 * Parses OHLCV exports from TradingView (time,open,high,low,close,Volume),
 * MT4 (date,time,o,h,l,c,vol — no header) and MT5 (<DATE> <TIME> <OPEN> … tab separated).
 */
export function parseCsv(text: string): ParsedCsv {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length < 2) throw new Error('The file has no rows.')
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ','
  const split = (l: string) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''))

  let col = { date: 0, time: -1, open: 1, high: 2, low: 3, close: 4, volume: 5 }
  let start = 0
  const first = split(lines[0])
  const hasHeader = first.some((c) => /[a-df-zA-DF-Z]/.test(c)) // letters other than the "e" of 1e5
  if (hasHeader) {
    start = 1
    const names = first.map((c) => c.toLowerCase().replace(/[<>]/g, ''))
    const find = (...keys: string[]) => names.findIndex((n) => keys.some((k) => n === k || n.startsWith(k)))
    col = {
      date: find('time', 'date', 'timestamp', 'datetime'),
      time: -1,
      open: find('open'),
      high: find('high'),
      low: find('low'),
      close: find('close'),
      volume: find('volume', 'tickvol', 'vol'),
    }
    const dateIdx = names.indexOf('date')
    const timeIdx = names.indexOf('time')
    if (dateIdx >= 0 && timeIdx >= 0 && dateIdx !== timeIdx) {
      col.date = dateIdx
      col.time = timeIdx
    }
    if (col.date < 0 || col.open < 0 || col.high < 0 || col.low < 0 || col.close < 0)
      throw new Error('Could not find time / open / high / low / close columns in the header.')
  } else if (first.length >= 6 && first[1].includes(':')) {
    col = { date: 0, time: 1, open: 2, high: 3, low: 4, close: 5, volume: 6 }
  }

  const map = new Map<number, Candle>()
  let decimals = 0
  for (let i = start; i < lines.length; i++) {
    const c = split(lines[i])
    const time = parseTime(c[col.date] ?? '', col.time >= 0 ? c[col.time] : undefined)
    const open = Number(c[col.open])
    const high = Number(c[col.high])
    const low = Number(c[col.low])
    const close = Number(c[col.close])
    if (!isFinite(time) || !isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close)) continue
    const volume = col.volume >= 0 ? Number(c[col.volume]) || 0 : 0
    if (i < start + 200) decimals = Math.max(decimals, countDecimals(c[col.close] ?? ''))
    map.set(time, { time, open, high: Math.max(high, open, close), low: Math.min(low, open, close), close, volume })
  }
  const candles = [...map.values()].sort((a, b) => a.time - b.time)
  if (candles.length < 10) throw new Error('Fewer than 10 valid candles were found. Check the file format.')

  // base timeframe = the most common gap between consecutive bars
  const gaps = new Map<number, number>()
  for (let i = 1; i < candles.length; i++) {
    const g = candles[i].time - candles[i - 1].time
    gaps.set(g, (gaps.get(g) ?? 0) + 1)
  }
  const baseTf = [...gaps.entries()].sort((a, b) => b[1] - a[1])[0][0]
  // Daily (and slower) files often carry a session-open hour; snap them to the UTC day.
  if (baseTf >= 86400) for (const c of candles) c.time = Math.floor(c.time / 86400) * 86400
  return { candles, baseTf, decimals: Math.min(decimals, 8) }
}
