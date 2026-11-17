import type { Candle } from './types'

export const bucketOf = (time: number, tf: number) => Math.floor(time / tf) * tf

/**
 * Builds higher-timeframe candles from base candles [0, cursor).
 *
 * This is the only path candles take to the chart. The forming candle is made
 * strictly from revealed base bars, so nothing past the cursor can leak into
 * its high / low / close.
 *
 * The result is cached and extended in place when the cursor only moves
 * forward, which keeps auto-play cheap on long datasets.
 */
export class Aggregator {
  private key = ''
  private cursor = 0
  private out: Candle[] = []

  get(base: Candle[], key: string, tf: number, cursor: number): Candle[] {
    const k = `${key}|${tf}`
    if (k !== this.key || cursor < this.cursor) {
      this.key = k
      this.cursor = 0
      this.out = []
    }
    const out = this.out
    for (let i = this.cursor; i < cursor; i++) {
      const b = base[i]
      const bt = bucketOf(b.time, tf)
      const last = out[out.length - 1]
      if (last && last.time === bt) {
        if (b.high > last.high) last.high = b.high
        if (b.low < last.low) last.low = b.low
        last.close = b.close
        last.volume += b.volume
      } else {
        out.push({ time: bt, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })
      }
    }
    this.cursor = cursor
    return out
  }
}

/** index of the last element with time <= t, or -1 */
export function indexAtOrBefore(arr: Candle[], t: number): number {
  let lo = 0
  let hi = arr.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid].time <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

/** number of base candles that open before time t */
export function countBefore(arr: Candle[], t: number): number {
  return indexAtOrBefore(arr, t - 1) + 1
}
