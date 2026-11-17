// Builds src/drills/scenarios.json.
//
// Each drill is a CONSTRUCTED price pattern: the path is scripted from waypoints
// (plus seeded noise) so the textbook answer is true by construction and the
// reveal really does play out the lesson. They are teaching patterns, not real
// market history. Re-run with `npm run drills` after editing.
import { writeFileSync, mkdirSync } from 'node:fs'

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const S = (to, bars, o = {}) => ({ to, bars, ...o }) // move to a price over n bars
const K = (c, v = 1) => ({ candle: c, v }) // one hand-shaped candle {h,l,c}
const CUT = 'CUT'
const TF = { '15m': 900, '1H': 3600, '4H': 14400, '1D': 86400 }

/** Turns a waypoint script (in "index 100" units) into OHLCV candles. */
function build(d, seed) {
  const r = rng(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r())
  const vol = d.vol ?? 0.22
  const rows = []
  let price = d.start
  let cutIndex = 0
  for (const seg of d.path) {
    if (seg === CUT) {
      cutIndex = rows.length
      continue
    }
    if (seg.candle) {
      const k = seg.candle
      const o = price
      rows.push({ o, h: Math.max(k.h, o, k.c), l: Math.min(k.l, o, k.c), c: k.c, v: seg.v * (0.9 + r() * 0.2) })
      price = k.c
      continue
    }
    const from = price
    for (let i = 1; i <= seg.bars; i++) {
      const f = i / seg.bars
      const target = from + (seg.to - from) * (f * f * (3 - 2 * f)) // smoothstep
      let c = target + gauss() * vol * (i === seg.bars ? 0.2 : 1)
      const o = price
      let h = Math.max(o, c) + Math.abs(gauss()) * vol * 0.55
      let l = Math.min(o, c) - Math.abs(gauss()) * vol * 0.55
      if (seg.floor != null) {
        c = Math.max(c, seg.floor + 0.04)
        l = Math.max(l, seg.floor)
      }
      if (seg.cap != null) {
        c = Math.min(c, seg.cap - 0.04)
        h = Math.min(h, seg.cap)
      }
      h = Math.max(h, o, c)
      l = Math.min(l, o, c)
      rows.push({ o, h, l, c, v: (seg.volu ?? 1) * (0.65 + r() * 0.7) * (1 + (Math.abs(c - o) / vol) * 0.25) })
      price = c
    }
  }
  const step = TF[d.timeframe]
  const t0 = Date.UTC(2025, 2, 3) / 1000
  const rd = (x) => Number((x * d.scale).toFixed(d.decimals))
  const candles = rows.map((k, i) => [t0 + i * step, rd(k.o), rd(k.h), rd(k.l), rd(k.c), Math.round(k.v * d.volBase)])
  return { candles, cutIndex, revealCount: rows.length - cutIndex, px: rd }
}

const BREAK_CHOICES = [
  { id: 'real', label: 'Real breakout — trade with it' },
  { id: 'fake', label: 'Fakeout — expect a reversal' },
  { id: 'wait', label: 'Unclear — stand aside' },
]

const DRILLS = [
  // ───────── S&R Mapping ─────────
  {
    id: 'sr-triple-support', title: 'The floor that keeps holding', category: 'S&R Mapping', difficulty: 'Beginner',
    symbol: 'EUR/USD', timeframe: '1H', scale: 0.0108, decimals: 5, volBase: 1800, start: 103.8,
    path: [S(104.6, 6), S(100.05, 12, { floor: 99.9 }), S(103.4, 10), S(100.1, 11, { floor: 99.9 }), S(102.9, 9), S(100.0, 10, { floor: 99.88 }), S(102.6, 10), S(101.6, 5), CUT, S(100.1, 7, { floor: 99.9 }), S(104.4, 16, { floor: 99.9 })],
    interactionType: 'draw_horizontal_level',
    promptText: 'Price is drifting lower again. Mark the support level buyers have been defending.',
    steps: ['Find the lows where price turned back up.', 'Tap the chart to drop a horizontal line on that floor.', 'Drag the line to fine-tune it, then submit.'],
    hint: 'Three separate swing lows stop at almost the same price. Use the cluster of wicks, not a single candle.',
    level: 100, tol: 0.4, direction: 'long',
    explanationText: 'Three reactions from the same price make it a proven support. On the fourth visit buyers stepped in again — the more times a level is tested and holds, the more traders watch it.',
  },
  {
    id: 'sr-resistance-ceiling', title: 'The ceiling', category: 'S&R Mapping', difficulty: 'Intermediate',
    symbol: 'XAU/USD', timeframe: '4H', scale: 23, decimals: 2, volBase: 950, start: 100,
    path: [S(104, 10), S(110, 12, { cap: 110.12 }), S(106.2, 9), S(110.05, 10, { cap: 110.12 }), S(107, 8), S(109.95, 9, { cap: 110.12 }), S(107.6, 7), S(108.6, 4), CUT, S(109.9, 6, { cap: 110.1 }), S(104.8, 16, { cap: 110.1 })],
    interactionType: 'draw_horizontal_level',
    promptText: 'The rally has stalled. Mark the resistance level where sellers keep showing up.',
    steps: ['Look for the highs that failed at a similar price.', 'Tap the chart to place the line across those highs.', 'Adjust and submit.'],
    hint: 'Ignore the lows this time — line up the three peaks. The level sits where the upper wicks end.',
    level: 110, tol: 0.4, direction: 'short',
    explanationText: 'Each push into this price was sold. A fourth test without a decisive close above it is more likely to be rejected than to break — which is exactly what followed.',
  },
  {
    id: 'sr-role-reversal', title: 'Old ceiling, new floor', category: 'S&R Mapping', difficulty: 'Pro',
    symbol: 'BTC/USDT', timeframe: '1H', scale: 640, decimals: 2, volBase: 210, start: 99,
    path: [S(101, 6), S(105, 9, { cap: 105.15 }), S(102.2, 8), S(104.95, 9, { cap: 105.15 }), S(103.1, 7), S(108.4, 9, { volu: 1.8 }), S(107.6, 4), CUT, S(105.1, 8, { floor: 104.9 }), S(110.6, 14, { floor: 104.9 })],
    interactionType: 'draw_horizontal_level',
    promptText: 'Price has just broken out and is starting to pull back. Mark where the pullback is most likely to find support.',
    steps: ['Find the level price had to break to get here.', 'Place your line on it — not on the current price.', 'Submit and watch the retest.'],
    hint: 'Resistance that breaks often flips into support. Where were the two highs before the breakout?',
    level: 105, tol: 0.45, direction: 'long',
    explanationText: 'The twice-rejected resistance became support once it broke (role reversal). Sellers who were trapped there cover, breakout buyers add — so the first retest of the broken level is a high-quality long area.',
  },

  // ───────── Breakout vs Fakeout ─────────
  {
    id: 'bo-real-up', title: 'Close above the range', category: 'Breakout vs Fakeout', difficulty: 'Beginner',
    symbol: 'BBCA.JK', timeframe: '1D', scale: 90, decimals: 0, volBase: 380000, start: 101,
    path: [S(104, 8, { cap: 104.1 }), S(100.3, 9), S(103.9, 9, { cap: 104.1 }), S(100.8, 8), S(103.8, 8, { cap: 104.1 }), S(102.6, 5), S(103.7, 5, { cap: 104.05 }), K({ h: 105.5, l: 103.6, c: 105.3 }, 2.6), K({ h: 106.1, l: 105.0, c: 105.9 }, 2.2), CUT, S(109.5, 14, { floor: 104.6 }), S(108.6, 4)],
    interactionType: 'multiple_choice', choices: BREAK_CHOICES,
    promptText: 'Price has pushed above a range it respected three times. Is this breakout real?',
    steps: ['Compare the breakout candles with the candles inside the range.', 'Check where they closed and what volume did.', 'Choose your read.'],
    hint: 'Look at the body size, the close relative to the range high, and the volume bars underneath.',
    level: 104, tol: 0.4, direction: 'long', answer: 'real',
    explanationText: 'Two wide-bodied candles closed well above the range high on more than double the usual volume, with almost no upper wick. Commitment plus acceptance above the level is what a genuine breakout looks like.',
  },
  {
    id: 'bo-fake-wick', title: 'The poke above', category: 'Breakout vs Fakeout', difficulty: 'Intermediate',
    symbol: 'EUR/USD', timeframe: '15m', scale: 0.0108, decimals: 5, volBase: 1500, start: 101,
    path: [S(104, 8, { cap: 104.1 }), S(100.4, 9), S(103.9, 8, { cap: 104.1 }), S(101, 8), S(103.8, 7, { cap: 104.1 }), S(102.4, 5), S(103.7, 5, { cap: 104.05 }), K({ h: 105.1, l: 103.5, c: 103.75 }, 0.9), K({ h: 104.2, l: 103.2, c: 103.4 }, 0.8), CUT, S(100.2, 14, { cap: 104.0 }), S(99.4, 5)],
    interactionType: 'multiple_choice', choices: BREAK_CHOICES,
    promptText: 'Price spiked through the range high. Is this breakout real?',
    steps: ['Find the candle that went above the range.', 'Where did it close? What happened on the next candle?', 'Choose your read.'],
    hint: 'A breakout needs a close beyond the level. A long wick above it is the market rejecting those prices.',
    level: 104, tol: 0.4, direction: 'short', answer: 'fake',
    explanationText: 'The move above the range was only a wick: price closed back inside, volume did not expand, and the next candle sold off. Stops above the high were taken and there was no follow-through — a classic fakeout that reverses to the other side of the range.',
  },
  {
    id: 'bo-spring', title: 'The flush below support', category: 'Breakout vs Fakeout', difficulty: 'Pro',
    symbol: 'BTC/USDT', timeframe: '4H', scale: 640, decimals: 2, volBase: 260, start: 103,
    path: [S(100.1, 8, { floor: 99.92 }), S(103.6, 9), S(100.2, 9, { floor: 99.92 }), S(103.2, 8), S(100.15, 8, { floor: 99.92 }), S(102.2, 6), S(100.4, 6, { floor: 99.95 }), K({ h: 100.5, l: 98.6, c: 100.25 }, 2.4), K({ h: 101.1, l: 100.1, c: 100.9 }, 1.3), CUT, S(104.8, 14, { floor: 100.0 }), S(105.6, 5)],
    interactionType: 'multiple_choice', choices: BREAK_CHOICES,
    promptText: 'Support finally gave way on heavy volume. Real breakdown, or a trap?',
    steps: ['Study the candle that broke the level — body versus wick.', 'Note where it closed and what the next candle did.', 'Choose your read.'],
    hint: 'High volume is not automatically confirmation. Ask who was left holding after that long lower wick.',
    level: 100, tol: 0.4, direction: 'long', answer: 'fake',
    explanationText: 'Price flushed below support but closed back above it, leaving a long lower wick on climactic volume, and the next candle held higher. That is a spring: stops were swept, sellers got trapped, and the volume was absorption — the move that follows is usually up.',
  },

  // ───────── SL & Risk-Reward ─────────
  {
    id: 'rr-pullback-long', title: 'Buying the pullback', category: 'SL & Risk-Reward', difficulty: 'Beginner',
    symbol: 'XAU/USD', timeframe: '1H', scale: 23, decimals: 2, volBase: 900, start: 98,
    path: [S(101.5, 9), S(100.2, 5), S(104.2, 10), S(102.6, 5), S(107, 10), S(104.2, 7, { floor: 103.5 }), K({ h: 104.5, l: 103.5, c: 104.3 }, 1.5), S(104.7, 3, { floor: 103.9 }), CUT, S(104.2, 4, { floor: 103.75 }), S(110.5, 18, { floor: 103.9 })],
    interactionType: 'place_rr_tool',
    promptText: 'An uptrend has pulled back to prior resistance and bounced. Plan the long: entry, stop and target.',
    steps: ['Pick the direction, then tap the chart near the current price to place the tool.', 'Drag the red line so the stop sits beyond the pullback low.', 'Drag the green line until the target is at least 2R away.'],
    hint: 'A stop belongs where the idea is wrong — below the swing low, not inside the pullback.',
    stopBeyond: 103.5, maxStopPct: 2.2, minRR: 2, entryTol: 0.5, direction: 'long',
    explanationText: 'The trade is "higher low holds". It is only wrong if price trades below the pullback low, so the stop goes just under it. With the stop there, a target near the next leg up pays more than twice the risk.',
  },
  {
    id: 'rr-rally-short', title: 'Selling the lower high', category: 'SL & Risk-Reward', difficulty: 'Intermediate',
    symbol: 'BTC/USDT', timeframe: '15m', scale: 640, decimals: 2, volBase: 150, start: 108,
    path: [S(104, 9), S(105.6, 5), S(101, 10), S(103, 5), S(97.4, 10), S(100.3, 8, { cap: 100.6 }), K({ h: 100.6, l: 99.5, c: 99.7 }, 1.6), S(99.4, 3, { cap: 100.2 }), CUT, S(100.35, 4, { cap: 100.45 }), S(94.2, 18, { cap: 100.3 })],
    interactionType: 'place_rr_tool',
    promptText: 'A downtrend has rallied into resistance and been rejected. Plan the short: entry, stop and target.',
    steps: ['Pick the direction, then tap near the current price to place the tool.', 'Put the stop beyond the high of the rejection.', 'Set a target worth at least 2R.'],
    hint: 'Price often re-tests the rejection area before falling. A stop tucked inside the wick gets taken out first.',
    stopBeyond: 100.6, maxStopPct: 2.4, minRR: 2, entryTol: 0.5, direction: 'short',
    explanationText: 'Price came back up to probe the rejection zone before dropping. Stops placed inside that wick were hit for a loss on a trade that then worked. Beyond the swing high is the only place the short idea is actually invalid.',
  },
  {
    id: 'rr-retest-long', title: 'The breakout retest', category: 'SL & Risk-Reward', difficulty: 'Pro',
    symbol: 'EUR/USD', timeframe: '4H', scale: 0.0108, decimals: 5, volBase: 2100, start: 102,
    path: [S(106, 8, { cap: 106.1 }), S(103, 8), S(105.9, 8, { cap: 106.1 }), S(103.8, 7), S(105.8, 6, { cap: 106.1 }), S(108.2, 7, { volu: 1.9 }), S(106.2, 6, { floor: 105.6 }), K({ h: 106.5, l: 105.6, c: 106.35 }, 1.4), S(106.5, 2, { floor: 106.0 }), CUT, S(105.85, 4, { floor: 105.72 }), S(111.2, 18, { floor: 105.9 })],
    interactionType: 'place_rr_tool',
    promptText: 'Price broke the range, came back to retest it and is holding. Plan the trade.',
    steps: ['Decide the direction from the structure, then tap near the current price.', 'Place the stop beyond the retest low — leave room for a second dip.', 'Set a target of at least 2R.'],
    hint: 'Retests are rarely one clean touch. Your stop has to survive another dip toward the retest low.',
    stopBeyond: 105.6, maxStopPct: 2.0, minRR: 2, entryTol: 0.5, direction: 'long',
    explanationText: 'Broken resistance held as support. Price dipped once more toward the retest low before trending — a stop under that low survives it, a tighter one does not. The breakout is only invalid back below the retest low.',
  },

  // ───────── Market Structure ─────────
  {
    id: 'ms-uptrend', title: 'Reading the staircase', category: 'Market Structure', difficulty: 'Beginner',
    symbol: 'XAU/USD', timeframe: '1D', scale: 23, decimals: 2, volBase: 1100, start: 96,
    path: [S(100, 8), S(98.4, 5), S(103, 9), S(101.2, 5), S(106, 9), S(104.3, 5), S(108.6, 8), S(107.2, 4), CUT, S(112, 12), S(110.6, 4), S(113.5, 6)],
    interactionType: 'multiple_choice',
    choices: [
      { id: 'up', label: 'Uptrend — higher highs and higher lows' },
      { id: 'down', label: 'Downtrend — lower highs and lower lows' },
      { id: 'range', label: 'Range — no trend' },
    ],
    promptText: 'What is the market structure, and which side should you be looking to trade?',
    steps: ['Mark each swing high and swing low in your head.', 'Is each one higher or lower than the last?', 'Choose the structure.'],
    hint: 'Compare each pullback low with the one before it.',
    direction: 'long', answer: 'up',
    explanationText: 'Every swing high is above the previous one and every pullback low is too. While that sequence is intact the path of least resistance is up: look for longs on pullbacks, not shorts on strength.',
  },
  {
    id: 'ms-break-of-structure', title: 'When the higher low fails', category: 'Market Structure', difficulty: 'Intermediate',
    symbol: 'BTC/USDT', timeframe: '1H', scale: 640, decimals: 2, volBase: 200, start: 96,
    path: [S(100, 8), S(98.4, 5), S(103.5, 9), S(101.6, 5), S(106, 8), S(103.8, 6), S(105.2, 6), S(102.9, 7, { volu: 1.6 }), S(103.3, 3), CUT, S(98.6, 14, { cap: 103.8 }), S(99.4, 4), S(97, 5)],
    interactionType: 'multiple_choice',
    choices: [
      { id: 'dip', label: 'Normal pullback — uptrend intact, buy the dip' },
      { id: 'bos', label: 'Bullish structure is broken — bias turns bearish' },
      { id: 'range', label: 'Sideways range — no bias' },
    ],
    promptText: 'This market was trending up. Read the last three swings — has anything changed?',
    steps: ['Find the most recent swing high. Did it beat the previous high?', 'Find the last higher low. Is price above or below it now?', 'Choose your read.'],
    hint: 'An uptrend needs higher highs AND higher lows. Check both conditions on the latest swings.',
    level: 103.8, tol: 0.4, direction: 'short', answer: 'bos',
    explanationText: 'The last rally made a lower high, then price closed below the previous higher low on rising volume. Both conditions of the uptrend failed — a break of structure. The broken low becomes resistance and the bias shifts to selling rallies.',
  },
  {
    id: 'ms-lower-high', title: 'Reversal or just a rally?', category: 'Market Structure', difficulty: 'Pro',
    symbol: 'EUR/USD', timeframe: '1H', scale: 0.0108, decimals: 5, volBase: 1700, start: 110,
    path: [S(105.5, 9), S(107.4, 5), S(102.4, 9), S(104.6, 5), S(99.6, 9), S(103.6, 9, { cap: 103.9, volu: 1.4 }), S(103.1, 3), CUT, S(98.2, 15, { cap: 103.7 }), S(99, 4), S(96.8, 5)],
    interactionType: 'multiple_choice',
    choices: [
      { id: 'rev', label: 'Trend reversal — the rally turns the bias bullish' },
      { id: 'lh', label: 'Still a downtrend — a pullback into a lower high' },
      { id: 'range', label: 'Range — no bias' },
    ],
    promptText: 'After a long decline, price has rallied hard. Has the trend reversed?',
    steps: ['Locate the last lower high of the downtrend.', 'Did this rally close above it?', 'Choose your read.'],
    hint: 'A strong rally is not a reversal until it takes out the previous lower high.',
    level: 104.6, tol: 0.4, direction: 'short', answer: 'lh',
    explanationText: 'The rally looked strong but stopped short of the last lower high, so the sequence of lower highs and lower lows is unbroken. Until that high is taken out this is a pullback inside a downtrend — and price went on to make a new low.',
  },
]

const out = DRILLS.map((d, i) => {
  const b = build(d, 101 + i * 17)
  const cutClose = b.candles[b.cutIndex - 1][4]
  const solution = { direction: d.direction, explanationText: d.explanationText }
  if (d.level != null) solution.zone = { price: b.px(d.level), tolerancePct: d.tol }
  if (d.answer) solution.choiceId = d.answer
  if (d.interactionType === 'place_rr_tool') {
    solution.zone = { price: cutClose, tolerancePct: d.entryTol }
    solution.stopBeyond = b.px(d.stopBeyond)
    solution.maxStopPct = d.maxStopPct
    solution.minRR = d.minRR
  }
  return {
    id: d.id, title: d.title, category: d.category, difficulty: d.difficulty, symbol: d.symbol, timeframe: d.timeframe, decimals: d.decimals,
    candles: b.candles, cutIndex: b.cutIndex, revealCount: b.revealCount,
    promptText: d.promptText, steps: d.steps, hint: d.hint, interactionType: d.interactionType, ...(d.choices ? { choices: d.choices } : {}), solution,
  }
})

// sanity report: does each reveal actually prove the lesson?
for (const s of out) {
  const post = s.candles.slice(s.cutIndex)
  const lo = Math.min(...post.map((c) => c[3]))
  const hi = Math.max(...post.map((c) => c[2]))
  const cut = s.candles[s.cutIndex - 1][4]
  const end = post[post.length - 1][4]
  let note = `cut ${cut} → end ${end} (lo ${lo}, hi ${hi})`
  if (s.solution.stopBeyond) note += ` | stopBeyond ${s.solution.stopBeyond} ${s.solution.direction === 'long' ? (lo > s.solution.stopBeyond ? 'SAFE' : 'HIT!') : hi < s.solution.stopBeyond ? 'SAFE' : 'HIT!'}`
  const moved = s.solution.direction === 'long' ? end > cut : end < cut
  console.log(`${moved ? 'ok ' : 'BAD'} ${s.id.padEnd(24)} ${s.cutIndex}+${s.revealCount}  ${note}`)
}

mkdirSync('src/drills', { recursive: true })
writeFileSync('src/drills/scenarios.json', JSON.stringify(out))
console.log(`wrote ${out.length} drills`)
