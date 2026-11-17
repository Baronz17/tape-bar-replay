import type { Candle, Dir, ExitReason, Order, Position, Trade } from './types'
import { uid } from './format'

export interface EngineCtx {
  spread: number
  commissionPct: number
  tf: number
  datasetId: string
  symbol: string
  sessionId: string
}

export interface EngineState {
  balance: number
  positions: Position[]
  orders: Order[]
}

/**
 * Fill model
 * - Chart prices are treated as mid. Every fill is moved half the spread against the trader.
 * - Commission is a % of notional per side, charged when the trade closes.
 * - A bar that gaps through a level fills at the bar's open (worse for stops, better for limits).
 * - If one bar touches both SL and TP the stop is assumed to have been hit first.
 * - A position opened inside a bar can be stopped on that same bar, but only takes
 *   profit on it if the bar also CLOSES beyond the target (the only case where the
 *   order of events is certain).
 */

export function openPosition(
  p: { dir: Dir; qty: number; level: number; sl: number | null; tp: number | null; tag: string; note: string; time: number },
  equity: number,
  ctx: EngineCtx,
): Position {
  const entry = p.level + (p.dir * ctx.spread) / 2
  const riskAmount = p.sl != null ? Math.abs(entry - p.sl) * p.qty : 0
  return {
    id: uid(),
    dir: p.dir,
    qty: p.qty,
    entry,
    entryTime: p.time,
    sl: p.sl,
    tp: p.tp,
    initialSl: p.sl,
    riskAmount,
    riskPct: equity > 0 ? (riskAmount / equity) * 100 : 0,
    plannedRR: p.sl != null && p.tp != null && entry !== p.sl ? Math.abs(p.tp - entry) / Math.abs(entry - p.sl) : null,
    slWidened: false,
    tag: p.tag,
    note: p.note,
    tf: ctx.tf,
  }
}

export function closePosition(pos: Position, level: number, time: number, reason: ExitReason, balance: number, ctx: EngineCtx): Trade {
  const exit = level - (pos.dir * ctx.spread) / 2
  const gross = (exit - pos.entry) * pos.dir * pos.qty
  const commission = (ctx.commissionPct / 100) * (pos.entry + exit) * pos.qty
  const pnl = gross - commission
  return {
    id: uid(),
    sessionId: ctx.sessionId,
    datasetId: ctx.datasetId,
    symbol: ctx.symbol,
    tf: pos.tf,
    dir: pos.dir,
    qty: pos.qty,
    entry: pos.entry,
    exit,
    entryTime: pos.entryTime,
    exitTime: time,
    initialSl: pos.initialSl,
    tp: pos.tp,
    plannedRR: pos.plannedRR,
    realizedR: pos.riskAmount > 0 ? pnl / pos.riskAmount : null,
    pnl,
    commission,
    riskPct: pos.riskPct,
    riskAmount: pos.riskAmount,
    slWidened: pos.slWidened,
    reason,
    tag: pos.tag,
    note: pos.note,
    balanceAfter: balance + pnl,
  }
}

function exitCheck(pos: Position, c: Candle, sameBar: boolean): { reason: ExitReason; level: number } | null {
  const { sl, tp } = pos
  if (pos.dir === 1) {
    if (sameBar) {
      if (sl != null && c.low <= sl) return { reason: 'sl', level: sl }
      if (tp != null && c.close >= tp) return { reason: 'tp', level: tp }
      return null
    }
    if (sl != null && c.open <= sl) return { reason: 'sl', level: c.open }
    if (tp != null && c.open >= tp) return { reason: 'tp', level: c.open }
    if (sl != null && c.low <= sl) return { reason: 'sl', level: sl }
    if (tp != null && c.high >= tp) return { reason: 'tp', level: tp }
    return null
  }
  if (sameBar) {
    if (sl != null && c.high >= sl) return { reason: 'sl', level: sl }
    if (tp != null && c.close <= tp) return { reason: 'tp', level: tp }
    return null
  }
  if (sl != null && c.open >= sl) return { reason: 'sl', level: c.open }
  if (tp != null && c.open <= tp) return { reason: 'tp', level: c.open }
  if (sl != null && c.high >= sl) return { reason: 'sl', level: sl }
  if (tp != null && c.low <= tp) return { reason: 'tp', level: tp }
  return null
}

/** price a pending order fills at on this bar, or null if it is not touched */
function fillLevel(o: Order, c: Candle): number | null {
  // buy limit and sell stop trigger when price trades DOWN to the level
  const triggersBelow = (o.type === 'limit') === (o.dir === 1)
  if (triggersBelow) {
    if (c.open <= o.price) return c.open
    return c.low <= o.price ? o.price : null
  }
  if (c.open >= o.price) return c.open
  return c.high >= o.price ? o.price : null
}

/** Advance the account through one newly revealed base candle. */
export function processCandle(state: EngineState, c: Candle, ctx: EngineCtx): EngineState & { trades: Trade[] } {
  if (!state.positions.length && !state.orders.length) return { ...state, trades: [] }
  let balance = state.balance
  const trades: Trade[] = []
  const positions: Position[] = []
  const orders: Order[] = []

  for (const pos of state.positions) {
    const hit = exitCheck(pos, c, false)
    if (hit) {
      const t = closePosition(pos, hit.level, c.time, hit.reason, balance, ctx)
      balance = t.balanceAfter
      trades.push(t)
    } else positions.push(pos)
  }

  for (const o of state.orders) {
    const level = fillLevel(o, c)
    if (level == null) {
      orders.push(o)
      continue
    }
    const pos = openPosition({ dir: o.dir, qty: o.qty, level, sl: o.sl, tp: o.tp, tag: o.tag, note: o.note, time: c.time }, balance, { ...ctx, tf: o.tf })
    const hit = exitCheck(pos, c, true)
    if (hit) {
      const t = closePosition(pos, hit.level, c.time, hit.reason, balance, ctx)
      balance = t.balanceAfter
      trades.push(t)
    } else positions.push(pos)
  }
  return { balance, positions, orders, trades }
}

export const unrealized = (pos: Position, price: number) => (price - pos.entry) * pos.dir * pos.qty
