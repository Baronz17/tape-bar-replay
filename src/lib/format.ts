export const TF_LIST = [900, 3600, 14400, 86400]

export function tfLabel(tf: number): string {
  if (tf % 86400 === 0) return tf / 86400 === 1 ? '1D' : `${tf / 86400}D`
  if (tf % 3600 === 0) return `${tf / 3600}H`
  return `${tf / 60}m`
}

/** Timeframes a dataset can be viewed in: its base plus every standard one that is a clean multiple. */
export function tfOptions(baseTf: number): number[] {
  const set = new Set<number>([baseTf])
  for (const tf of TF_LIST) if (tf > baseTf && tf % baseTf === 0) set.add(tf)
  return [...set].sort((a, b) => a - b)
}

export function fmtPrice(v: number | null | undefined, decimals: number): string {
  if (v == null || !isFinite(v)) return '—'
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

/** Money with the account's currency symbol. "Rp" style currencies get no decimals. */
export function fmtMoney(v: number, currency: string, signed = false): string {
  if (!isFinite(v)) return '—'
  const big = /rp|idr|¥|jpy/i.test(currency)
  const abs = Math.abs(v).toLocaleString(big ? 'id-ID' : 'en-US', {
    minimumFractionDigits: big ? 0 : 2,
    maximumFractionDigits: big ? 0 : 2,
  })
  const sign = v < 0 ? '−' : signed && v > 0 ? '+' : ''
  const sep = currency.length > 1 ? ' ' : ''
  return `${sign}${currency}${sep}${abs}`
}

export function fmtR(v: number | null | undefined, signed = true): string {
  if (v == null || !isFinite(v)) return '—'
  const sign = v < 0 ? '−' : signed && v > 0 ? '+' : ''
  return `${sign}${Math.abs(v).toFixed(2)}R`
}

export function fmtQty(v: number): string {
  if (!isFinite(v)) return '—'
  const a = Math.abs(v)
  const d = a >= 1000 ? 0 : a >= 10 ? 2 : a >= 1 ? 3 : 5
  return v.toLocaleString('en-US', { maximumFractionDigits: d })
}

const pad = (n: number) => String(n).padStart(2, '0')

export function fmtTime(t: number, withTime = true): string {
  const d = new Date(t * 1000)
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  return withTime ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date
}

/** value for <input type="datetime-local">, in UTC */
export function toInputDate(t: number): string {
  return fmtTime(t).replace(' ', 'T')
}
export function fromInputDate(s: string): number {
  return Math.floor(Date.parse(s + (s.length <= 10 ? 'T00:00' : '') + 'Z') / 1000)
}

export function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function roundTo(v: number, decimals: number): number {
  const m = 10 ** decimals
  return Math.round(v * m) / m
}
