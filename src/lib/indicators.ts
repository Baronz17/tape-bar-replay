import type { Candle } from './types'

/**
 * Incremental indicator buffers. `update(candles, from)` recomputes values
 * from index `from` to the end, so a forward replay step only touches the
 * forming bar instead of the whole history.
 */
export class Ema {
  values: number[] = []
  constructor(readonly period: number) {}
  update(c: Candle[], from: number) {
    const k = 2 / (this.period + 1)
    const v = this.values
    v.length = c.length
    for (let i = Math.max(0, from); i < c.length; i++) v[i] = i === 0 ? c[0].close : c[i].close * k + v[i - 1] * (1 - k)
  }
  /** an EMA is only meaningful once `period` bars exist */
  ready(i: number) {
    return i >= this.period - 1
  }
}

export class Rsi {
  values: number[] = []
  private gain: number[] = []
  private loss: number[] = []
  constructor(readonly period = 14) {}
  update(c: Candle[], from: number) {
    const n = this.period
    const { gain, loss, values } = this
    gain.length = loss.length = values.length = c.length
    for (let i = Math.max(0, from); i < c.length; i++) {
      if (i === 0) {
        gain[0] = loss[0] = 0
        values[0] = NaN
        continue
      }
      const d = c[i].close - c[i - 1].close
      const g = d > 0 ? d : 0
      const l = d < 0 ? -d : 0
      if (i < n) {
        // seed phase: running sums
        gain[i] = gain[i - 1] + g
        loss[i] = loss[i - 1] + l
        values[i] = NaN
      } else {
        const pg = i === n ? gain[i - 1] / (n - 1 || 1) : gain[i - 1]
        const pl = i === n ? loss[i - 1] / (n - 1 || 1) : loss[i - 1]
        // Wilder smoothing
        gain[i] = (pg * (n - 1) + g) / n
        loss[i] = (pl * (n - 1) + l) / n
        values[i] = loss[i] === 0 ? 100 : 100 - 100 / (1 + gain[i] / loss[i])
      }
    }
  }
}
