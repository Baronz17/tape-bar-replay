import { create } from 'zustand'
import raw from './scenarios.json'
import type { Candle, Drawing } from '../lib/types'
import { Aggregator } from '../lib/aggregate'
import { dbGet, dbSet } from '../lib/db'
import { roundTo, tfLabel, uid } from '../lib/format'
import { activeMeta, getCandles, useStore } from '../store'
import { CATEGORIES, type DrillCategory, type DrillGrade, type DrillScenario, type Difficulty } from './types'

type RawScenario = Omit<DrillScenario, 'candles'> & { candles: number[][] }

export const BUILT_IN: DrillScenario[] = (raw as unknown as RawScenario[]).map((s) => ({
  ...s,
  candles: s.candles.map(([time, open, high, low, close, volume]): Candle => ({ time, open, high, low, close, volume })),
}))

export interface DrillResult {
  attempts: number
  best: number
  last: number
  passed: boolean
}

interface DrillState {
  loaded: boolean
  results: Record<string, DrillResult>
  streak: number
  bestStreak: number
  blind: boolean
  custom: DrillScenario[]
  load: () => Promise<void>
  record: (id: string, g: DrillGrade) => void
  setBlind: (v: boolean) => void
  addCustom: (s: DrillScenario) => void
  removeCustom: (id: string) => void
  resetProgress: () => void
}

const save = () => {
  const { results, streak, bestStreak, blind, custom } = useDrills.getState()
  dbSet('drills', { results, streak, bestStreak, blind, custom }).catch((e) => console.warn('drill save failed', e))
}

export const useDrills = create<DrillState>((set, get) => ({
  loaded: false,
  results: {},
  streak: 0,
  bestStreak: 0,
  blind: false,
  custom: [],
  load: async () => {
    if (get().loaded) return
    const saved = await dbGet<Partial<DrillState>>('drills').catch(() => undefined)
    set({ ...saved, loaded: true })
  },
  record: (id, g) => {
    const s = get()
    const prev = s.results[id]
    const streak = g.passed ? s.streak + 1 : 0
    set({
      results: { ...s.results, [id]: { attempts: (prev?.attempts ?? 0) + 1, best: Math.max(prev?.best ?? 0, g.score), last: g.score, passed: (prev?.passed ?? false) || g.passed } },
      streak,
      bestStreak: Math.max(s.bestStreak, streak),
    })
    save()
  },
  setBlind: (blind) => {
    set({ blind })
    save()
  },
  addCustom: (sc) => {
    set({ custom: [...get().custom, sc] })
    save()
  },
  removeCustom: (id) => {
    const results = { ...get().results }
    delete results[id]
    set({ custom: get().custom.filter((c) => c.id !== id), results })
    save()
  },
  resetProgress: () => {
    set({ results: {}, streak: 0, bestStreak: 0 })
    save()
  },
}))

export const allDrills = (s = useDrills.getState()) => [...BUILT_IN, ...s.custom]

export function categoryStats(cat: DrillCategory, s = useDrills.getState()) {
  const list = allDrills(s).filter((d) => d.category === cat)
  const done = list.filter((d) => s.results[d.id]?.passed).length
  const tried = list.map((d) => s.results[d.id]).filter(Boolean) as DrillResult[]
  return { total: list.length, done, attempted: tried.length, accuracy: tried.length ? tried.reduce((a, r) => a + r.best, 0) / tried.length : null }
}

/** Same drill for everyone on a given calendar day, picked pseudo-randomly from the built-in set. */
export function dailyDrill(): DrillScenario {
  const d = new Date()
  const key = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()
  let h = key
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  return BUILT_IN[((h ^ (h >>> 16)) >>> 0) % BUILT_IN.length]
}

/** Next drill to offer: first unpassed one in the same category, then any unpassed, then simply the next in order. */
export function nextDrill(current: DrillScenario): DrillScenario {
  const s = useDrills.getState()
  const list = allDrills(s)
  const pending = (d: DrillScenario) => d.id !== current.id && !s.results[d.id]?.passed
  return list.find((d) => d.category === current.category && pending(d)) ?? list.find(pending) ?? list[(list.findIndex((d) => d.id === current.id) + 1) % list.length]
}

// ───── custom drills from the replay ─────

const BEFORE = 140
const AFTER = 24

export interface CustomDraft {
  title: string
  category: DrillCategory
  difficulty: Difficulty
  explanationText: string
}

/** What kind of drill the current replay state can be turned into. */
export function customSource(): { kind: 'level' | 'rr' | 'direction'; drawing?: Drawing } {
  const s = useStore.getState()
  const d = (s.drawings[s.activeId] ?? []).find((x) => x.id === s.selectedDrawing)
  if (d?.kind === 'hline') return { kind: 'level', drawing: d }
  if (d?.kind === 'long' || d?.kind === 'short') return { kind: 'rr', drawing: d }
  return { kind: 'direction' }
}

/**
 * Freezes the current replay position into a drill: the candles on screen become
 * the question, the next candles of the dataset become the reveal. The answer comes
 * from the selected drawing (a level or a long/short tool); with nothing selected it
 * becomes a "what happens next" question graded on the actual outcome.
 */
export function buildCustomDrill(draft: CustomDraft): DrillScenario | string {
  const s = useStore.getState()
  const meta = activeMeta(s)
  if (!meta) return 'No dataset is loaded.'
  if (!s.replay) return 'Start a replay first, so there is a hidden future to reveal.'
  const base = getCandles(s.activeId)
  const full = new Aggregator().get(base, 'custom', s.tf, base.length)
  const now = base[s.cursor - 1].time + meta.baseTf
  let cut = 0
  while (cut < full.length && full[cut].time + s.tf <= now) cut++ // only completed candles go in the question
  if (cut < 30) return 'Not enough history before this point — step forward a little first.'
  if (full.length - cut < AFTER) return `Not enough data after this point: the reveal needs ${AFTER} more ${tfLabel(s.tf)} candles.`

  const from = Math.max(0, cut - BEFORE)
  const candles = full.slice(from, cut + AFTER).map((c) => ({ ...c }))
  const cutIndex = cut - from
  const last = candles[cutIndex - 1].close
  const src = customSource()
  const common = {
    id: 'custom-' + uid(), title: draft.title.trim() || `${meta.symbol} ${tfLabel(s.tf)} drill`, category: draft.category, difficulty: draft.difficulty,
    symbol: meta.symbol, timeframe: tfLabel(s.tf), decimals: meta.decimals, candles, cutIndex, revealCount: AFTER, custom: true as const,
  }
  const why = draft.explanationText.trim()

  if (src.kind === 'level' && src.drawing?.kind === 'hline') {
    const price = roundTo(src.drawing.p, meta.decimals)
    return {
      ...common, interactionType: 'draw_horizontal_level',
      promptText: 'Mark the key horizontal level on this chart.',
      steps: ['Study the swing highs and lows.', 'Tap the chart to place the level.', 'Fine-tune it and submit.'],
      hint: 'Look for the price that was respected more than once.',
      solution: { zone: { price, tolerancePct: 0.4 }, direction: last >= price ? 'long' : 'short', explanationText: why || 'This is the level you marked when you saved the drill.' },
    }
  }
  if (src.kind === 'rr' && (src.drawing?.kind === 'long' || src.drawing?.kind === 'short')) {
    const d = src.drawing
    const dir = d.kind
    return {
      ...common, interactionType: 'place_rr_tool',
      promptText: 'Plan the trade from here: direction, entry, stop and target.',
      steps: ['Choose the direction and tap near the current price.', 'Place the stop beyond the level that would prove the idea wrong.', 'Set a target of at least 2R.'],
      hint: 'Find the swing that invalidates the idea and put the stop on the far side of it.',
      solution: {
        zone: { price: last, tolerancePct: 0.6 }, direction: dir,
        // any stop at least 80% as far as the saved one counts as "beyond the structure"
        stopBeyond: roundTo(d.entry + (d.sl - d.entry) * 0.8, meta.decimals),
        maxStopPct: (Math.abs(d.entry - d.sl) / d.entry) * 100 * 2.5, minRR: 2,
        explanationText: why || `Saved plan: ${dir} with the stop at ${d.sl.toFixed(meta.decimals)}.`,
      },
    }
  }

  // "What happens next?" — graded on the real outcome, measured in ATRs so it adapts to the instrument.
  const pre = candles.slice(Math.max(1, cutIndex - 14), cutIndex)
  const atr = pre.reduce((a, c) => a + (c.high - c.low), 0) / pre.length
  const move = candles[candles.length - 1].close - last
  const direction = move > atr * 1.5 ? 'long' : move < -atr * 1.5 ? 'short' : 'wait'
  return {
    ...common, interactionType: 'multiple_choice',
    choices: [
      { id: 'long', label: 'Higher — look for longs' },
      { id: 'short', label: 'Lower — look for shorts' },
      { id: 'wait', label: 'No clear move — stand aside' },
    ],
    promptText: `Where is price most likely to be ${AFTER} candles from now?`,
    steps: ['Read the trend and the nearest levels.', 'Decide which side has the edge — or neither.', 'Choose your answer.'],
    hint: 'Trade the structure you can see, not the move you hope for.',
    solution: { direction, choiceId: direction, explanationText: why || `Over the next ${AFTER} candles price moved ${(move / atr).toFixed(1)} ATR ${move >= 0 ? 'up' : 'down'}. A move under 1.5 ATR counts as "no clear move".` },
  }
}

export { CATEGORIES }
