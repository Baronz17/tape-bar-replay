import { fmtPrice } from '../lib/format'
import { PASS_SCORE, type DrillAnswer, type DrillGrade, type DrillScenario, type GradeLine, type RrPlan } from './types'

const DIR_WORD = { long: 'long', short: 'short', wait: 'stand aside' }

/** What happened to a planned trade over the revealed candles. */
export function simulatePlan(s: DrillScenario, rr: RrPlan): 'tp' | 'sl' | 'open' | 'unfilled' {
  const market = s.candles[s.cutIndex - 1].close
  // an entry away from the market is a resting order: it has to be traded through first
  let filled = Math.abs(rr.entry - market) / market <= 0.0015
  for (const c of s.candles.slice(s.cutIndex, s.cutIndex + s.revealCount)) {
    if (!filled) {
      if (c.low > rr.entry || c.high < rr.entry) continue
      filled = true
    }
    const stop = rr.dir === 1 ? c.low <= rr.sl : c.high >= rr.sl
    const target = rr.dir === 1 ? c.high >= rr.tp : c.low <= rr.tp
    if (stop) return 'sl' // same-bar ties count as a stop, like the replay engine
    if (target) return 'tp'
  }
  return filled ? 'open' : 'unfilled'
}

export function grade(s: DrillScenario, a: DrillAnswer): DrillGrade {
  const sol = s.solution
  const dec = s.decimals
  const lines: GradeLine[] = []
  let score = 0

  if (s.interactionType === 'multiple_choice') {
    const ok = a.choiceId === sol.choiceId
    const pick = s.choices?.find((c) => c.id === a.choiceId)?.label ?? '—'
    const right = s.choices?.find((c) => c.id === sol.choiceId)?.label ?? '—'
    score = ok ? 100 : 0
    lines.push({ label: 'Chart read', ok, scored: true, detail: ok ? pick : `You chose "${pick}". The evidence pointed to "${right}".` })
    const post = s.candles.slice(s.cutIndex, s.cutIndex + s.revealCount)
    const from = s.candles[s.cutIndex - 1].close
    const to = post[post.length - 1]?.close ?? from
    lines.push({ label: 'What price did', ok: true, scored: false, detail: `${fmtPrice(from, dec)} → ${fmtPrice(to, dec)} (${to >= from ? '+' : '−'}${Math.abs(((to - from) / from) * 100).toFixed(2)}%). Bias: ${DIR_WORD[sol.direction]}.` })
  }

  if (s.interactionType === 'draw_horizontal_level' && sol.zone) {
    const { price, tolerancePct } = sol.zone
    const off = a.level != null ? (Math.abs(a.level - price) / price) * 100 : Infinity
    // full marks inside half the tolerance, sliding to 70 at its edge, then to 0 at twice the tolerance
    const ratio = off / tolerancePct
    score = ratio <= 0.5 ? 100 : ratio <= 1 ? 100 - (ratio - 0.5) * 60 : ratio <= 2 ? 70 - (ratio - 1) * 70 : 0
    lines.push({
      label: 'Level precision', ok: ratio <= 1, scored: true,
      detail: a.level == null ? 'No level was placed.' : `Your line ${fmtPrice(a.level, dec)} vs ${fmtPrice(price, dec)} — off by ${off.toFixed(2)}% (tolerance ${tolerancePct}%).`,
    })
    const lo = price * (1 - tolerancePct / 100)
    const hi = price * (1 + tolerancePct / 100)
    const touched = s.candles.slice(s.cutIndex, s.cutIndex + s.revealCount).some((c) => c.low <= hi && c.high >= lo)
    lines.push({ label: 'Price reaction', ok: touched, scored: false, detail: touched ? 'Price came back to the zone during the reveal and reacted from it.' : 'Price did not revisit the zone during the reveal.' })
  }

  if (s.interactionType === 'place_rr_tool') {
    const rr = a.rr
    if (!rr) {
      lines.push({ label: 'Trade plan', ok: false, scored: true, detail: 'No position was placed on the chart.' })
    } else {
      const want = sol.direction === 'long' ? 1 : -1
      const dirOk = rr.dir === want
      const risk = Math.abs(rr.entry - rr.sl)
      const ratio = risk > 0 ? Math.abs(rr.tp - rr.entry) / risk : 0
      const stopPct = (risk / rr.entry) * 100
      const beyond = sol.stopBeyond != null && (want === 1 ? rr.sl < sol.stopBeyond : rr.sl > sol.stopBeyond)
      const tooWide = sol.maxStopPct != null && stopPct > sol.maxStopPct
      const slOk = dirOk && beyond && !tooWide
      const rrOk = ratio >= (sol.minRR ?? 2) - 0.005
      const entryOff = sol.zone ? (Math.abs(rr.entry - sol.zone.price) / sol.zone.price) * 100 : 0
      const entryOk = !sol.zone || entryOff <= sol.zone.tolerancePct

      lines.push({ label: 'Direction', ok: dirOk, scored: true, detail: dirOk ? `${rr.dir === 1 ? 'Long' : 'Short'} — with the structure.` : `You went ${rr.dir === 1 ? 'long' : 'short'}; the structure favoured a ${sol.direction}.` })
      lines.push({
        label: 'SL safety', ok: slOk, scored: true,
        detail: !dirOk ? 'Not assessed — the trade is on the wrong side.'
          : !beyond ? `Stop ${fmtPrice(rr.sl, dec)} sits inside the structure. It needs to be beyond ${fmtPrice(sol.stopBeyond, dec)}.`
          : tooWide ? `Stop is ${stopPct.toFixed(2)}% away — wider than this setup needs (max ${sol.maxStopPct}%).`
          : `Stop ${fmtPrice(rr.sl, dec)} is beyond the invalidation level ${fmtPrice(sol.stopBeyond, dec)}.`,
      })
      lines.push({ label: 'R:R ratio', ok: rrOk, scored: true, detail: `1 : ${ratio.toFixed(2)} (minimum 1 : ${sol.minRR ?? 2}).` })
      lines.push({ label: 'Entry', ok: entryOk, scored: true, detail: entryOk ? 'Close to the current price.' : `Entry is ${entryOff.toFixed(2)}% from the market — price may never fill it.` })
      score = (dirOk ? 30 : 0) + (slOk ? 30 : 0) + (rrOk ? 30 : 0) + (entryOk ? 10 : 0)
      if (!dirOk) score = Math.min(score, 40)
      // the stop is the point of these drills: an unsafe one cannot pass on the other checks alone
      else if (!slOk) score = Math.min(score, 60)
      const res = simulatePlan(s, rr)
      lines.push({ label: 'Outcome', ok: res === 'tp', scored: false, detail: res === 'tp' ? 'Target reached before the stop.' : res === 'sl' ? 'Stopped out during the reveal.' : res === 'unfilled' ? 'Price never came back to your entry — the order would not have filled.' : 'Neither stop nor target was reached in the reveal.' })
    }
  }

  score = Math.round(Math.max(0, Math.min(100, score)))
  return { score, passed: score >= PASS_SCORE, lines }
}
