import type { Candle } from '../lib/types'

export const CATEGORIES = ['S&R Mapping', 'Breakout vs Fakeout', 'SL & Risk-Reward', 'Market Structure'] as const
export type DrillCategory = (typeof CATEGORIES)[number]
export type Difficulty = 'Beginner' | 'Intermediate' | 'Pro'
export type InteractionType = 'multiple_choice' | 'draw_horizontal_level' | 'place_rr_tool'
export type DrillDirection = 'long' | 'short' | 'wait'

export interface DrillSolution {
  /** key price with tolerance: the level to draw, the level in question, or (R:R drills) the entry area */
  zone?: { price: number; tolerancePct: number }
  direction: DrillDirection
  /** multiple choice: id of the correct option */
  choiceId?: string
  /** R:R drills: the structure level the stop must sit beyond */
  stopBeyond?: number
  /** R:R drills: widest acceptable stop, % of entry */
  maxStopPct?: number
  minRR?: number
  explanationText: string
}

export interface DrillScenario {
  id: string
  title: string
  category: DrillCategory
  difficulty: Difficulty
  symbol: string
  timeframe: string
  decimals: number
  candles: Candle[]
  /** candles [0, cutIndex) are visible while answering */
  cutIndex: number
  /** candles auto-played after submitting */
  revealCount: number
  promptText: string
  steps: string[]
  hint: string
  interactionType: InteractionType
  choices?: { id: string; label: string }[]
  solution: DrillSolution
  custom?: boolean
}

export interface RrPlan {
  dir: 1 | -1
  entry: number
  sl: number
  tp: number
}

export interface DrillAnswer {
  choiceId?: string
  level?: number
  rr?: RrPlan
}

export interface GradeLine {
  label: string
  ok: boolean
  detail: string
  /** false = shown for context, does not affect the score */
  scored: boolean
}

export interface DrillGrade {
  score: number
  passed: boolean
  lines: GradeLine[]
}

export const PASS_SCORE = 70
