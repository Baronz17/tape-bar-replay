import type { Trade } from './types'

export interface Stats {
  count: number
  wins: number
  losses: number
  winRate: number
  profitFactor: number
  net: number
  expectancy: number
  expectancyR: number | null
  avgWin: number
  avgLoss: number
  maxConsecLosses: number
  maxDrawdownPct: number
  totalR: number
  /** equity after each trade, starting with the opening balance */
  equity: number[]
  /** drawdown from the running peak, in % (<= 0) */
  drawdown: number[]
}

export function computeStats(trades: Trade[], startBalance: number): Stats {
  let grossWin = 0
  let grossLoss = 0
  let wins = 0
  let losses = 0
  let streak = 0
  let maxStreak = 0
  let rSum = 0
  let rCount = 0
  let eq = startBalance
  let peak = startBalance
  let maxDd = 0
  const equity = [startBalance]
  const drawdown = [0]

  for (const t of trades) {
    if (t.pnl > 0) {
      wins++
      grossWin += t.pnl
      streak = 0
    } else if (t.pnl < 0) {
      losses++
      grossLoss -= t.pnl
      streak++
      if (streak > maxStreak) maxStreak = streak
    }
    if (t.realizedR != null) {
      rSum += t.realizedR
      rCount++
    }
    eq += t.pnl
    if (eq > peak) peak = eq
    const dd = peak > 0 ? ((eq - peak) / peak) * 100 : 0
    if (dd < maxDd) maxDd = dd
    equity.push(eq)
    drawdown.push(dd)
  }
  const count = trades.length
  const net = grossWin - grossLoss
  return {
    count,
    wins,
    losses,
    winRate: count ? (wins / count) * 100 : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    net,
    expectancy: count ? net / count : 0,
    expectancyR: rCount ? rSum / rCount : null,
    avgWin: wins ? grossWin / wins : 0,
    avgLoss: losses ? grossLoss / losses : 0,
    maxConsecLosses: maxStreak,
    maxDrawdownPct: maxDd,
    totalR: rSum,
    equity,
    drawdown,
  }
}

export interface Finding {
  level: 'bad' | 'warn' | 'good'
  title: string
  detail: string
}

/** Behavioural review of a set of trades (normally one practice session). */
export function reviewBehaviour(trades: Trade[]): Finding[] {
  const out: Finding[] = []
  if (!trades.length) return out
  const n = (k: number) => `${k} trade${k === 1 ? '' : 's'}`

  const over = trades.filter((t) => t.riskPct > 2.05)
  if (over.length) {
    const worst = Math.max(...over.map((t) => t.riskPct))
    out.push({ level: 'bad', title: `Over-risked on ${n(over.length)}`, detail: `Risk went above 2% of equity (highest: ${worst.toFixed(1)}%). A short losing streak at that size does real damage — keep it at 1–2%.` })
  }
  const noStop = trades.filter((t) => t.initialSl == null)
  if (noStop.length) out.push({ level: 'bad', title: `${n(noStop.length)} without a stop loss`, detail: 'With no stop there is no defined risk, so the result cannot be measured in R. Decide the exit before the entry.' })

  const widened = trades.filter((t) => t.slWidened)
  if (widened.length) out.push({ level: 'bad', title: `Stop moved further away on ${n(widened.length)}`, detail: 'Widening or removing a stop after entry turns a planned loss into an unplanned one. Tightening is fine; giving a loser more room is not.' })

  const lowRR = trades.filter((t) => t.plannedRR != null && t.plannedRR < 1)
  if (lowRR.length) out.push({ level: 'warn', title: `${n(lowRR.length)} planned below 1:1`, detail: 'A target smaller than the risk needs a very high win rate just to break even.' })

  let sizedUp = 0
  for (let i = 1; i < trades.length; i++) {
    const prev = trades[i - 1]
    const cur = trades[i]
    if (prev.pnl < 0 && prev.riskAmount > 0 && cur.riskAmount > prev.riskAmount * 1.3) sizedUp++
  }
  if (sizedUp) out.push({ level: 'warn', title: `Sized up after a loss ${sizedUp}×`, detail: 'Risk jumped by 30% or more on the trade right after a loser — the usual signature of trying to win it back.' })

  const cutEarly = trades.filter((t) => t.reason === 'manual' && t.pnl > 0 && t.plannedRR != null && t.realizedR != null && t.realizedR < t.plannedRR * 0.5)
  if (cutEarly.length) out.push({ level: 'warn', title: `Closed ${n(cutEarly.length)} well before target`, detail: 'Winners were taken at less than half the planned reward. If that keeps happening, the plan and the execution disagree.' })

  if (!out.length) out.push({ level: 'good', title: 'Clean execution', detail: 'Every trade had a stop, risk stayed at or under 2%, and no stop was widened.' })
  return out
}
