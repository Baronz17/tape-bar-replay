export interface Candle {
  /** bar open time, unix seconds (UTC) */
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type DataSource = 'sample' | 'binance' | 'csv'

export interface DatasetMeta {
  id: string
  symbol: string
  name: string
  source: DataSource
  /** seconds per bar of the stored (lowest) timeframe */
  baseTf: number
  decimals: number
  /** units per 1 lot, used only for display in the size calculator */
  lotSize: number
  /** default simulated spread in price units */
  spread: number
  count: number
  from: number
  to: number
}

export type Dir = 1 | -1

export interface Position {
  id: string
  dir: Dir
  qty: number
  entry: number
  entryTime: number
  sl: number | null
  tp: number | null
  /** stop at the moment of entry — the reference for R multiples */
  initialSl: number | null
  /** money at risk at entry (0 when there was no stop) */
  riskAmount: number
  /** risk as % of equity at entry */
  riskPct: number
  plannedRR: number | null
  slWidened: boolean
  tag: string
  note: string
  tf: number
}

export type OrderType = 'limit' | 'stop'

export interface Order {
  id: string
  type: OrderType
  dir: Dir
  qty: number
  price: number
  sl: number | null
  tp: number | null
  tag: string
  note: string
  createdTime: number
  tf: number
}

export type ExitReason = 'tp' | 'sl' | 'manual'

export interface Trade {
  id: string
  sessionId: string
  datasetId: string
  symbol: string
  tf: number
  dir: Dir
  qty: number
  entry: number
  exit: number
  entryTime: number
  exitTime: number
  initialSl: number | null
  tp: number | null
  plannedRR: number | null
  /** net result in R; null when the trade had no stop */
  realizedR: number | null
  pnl: number
  commission: number
  riskPct: number
  riskAmount: number
  slWidened: boolean
  reason: ExitReason
  tag: string
  note: string
  balanceAfter: number
}

export interface Pt {
  t: number
  p: number
}

export type Drawing =
  | { id: string; kind: 'hline'; p: number }
  | { id: string; kind: 'trend' | 'ray' | 'rect'; a: Pt; b: Pt }
  | { id: string; kind: 'long' | 'short'; t1: number; t2: number; entry: number; sl: number; tp: number }

export type Tool = 'cursor' | 'hline' | 'trend' | 'ray' | 'rect' | 'long' | 'short' | 'cut'

export interface Indicators {
  ema20: boolean
  ema50: boolean
  ema200: boolean
  rsi: boolean
  volume: boolean
}

export interface AccountConfig {
  startBalance: number
  currency: string
  /** percent of notional charged per side */
  commissionPct: number
  /** per-dataset spread override, in price units */
  spreads: Record<string, number>
}

export interface Session {
  id: string
  startedAt: number
  startBalance: number
  datasetId: string
  barsPlayed: number
}

export const STRATEGY_TAGS = ['Breakout', 'Pullback', 'S&R Bounce', 'Trend Continuation', 'Reversal', 'Range', 'Other']
