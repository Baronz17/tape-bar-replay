import { create } from 'zustand'
import type { AccountConfig, Candle, DatasetMeta, Dir, Drawing, Indicators, Order, Position, Session, Tool, Trade } from './lib/types'
import { Aggregator, bucketOf, countBefore } from './lib/aggregate'
import { buildSampleDatasets } from './lib/sampleData'
import { closePosition, openPosition, processCandle, unrealized, type EngineCtx } from './lib/engine'
import { dbDel, dbGet, dbSet } from './lib/db'
import { fmtMoney, fmtR, tfOptions, uid } from './lib/format'

// Candle arrays are large and immutable, so they live outside the reactive state.
const candleCache = new Map<string, Candle[]>()
export const getCandles = (id: string): Candle[] => candleCache.get(id) ?? []
const aggregator = new Aggregator()

interface Snapshot {
  cursor: number
  balance: number
  positions: Position[]
  orders: Order[]
  tradesLen: number
}
/** undo stack for Step Back — one entry per forward step */
let history: Snapshot[] = []

export type PanelTab = 'trade' | 'positions' | 'journal' | 'stats' | 'indicators'
export type Modal = 'data' | 'settings' | 'summary' | null

export interface TicketDraft {
  dir: Dir
  entry: number
  sl: number
  tp: number
  nonce: number
}

export interface OrderRequest {
  kind: 'market' | 'limit' | 'stop'
  dir: Dir
  qty: number
  price: number | null
  sl: number | null
  tp: number | null
  tag: string
  note: string
}

interface State {
  ready: boolean
  datasets: DatasetMeta[]
  activeId: string
  tf: number
  /** number of revealed base candles; everything at index >= cursor is the hidden future */
  cursor: number
  replay: boolean
  playing: boolean
  speed: number

  tool: Tool
  drawings: Record<string, Drawing[]>
  selectedDrawing: string | null
  indicators: Indicators

  account: AccountConfig
  balance: number
  positions: Position[]
  orders: Order[]
  trades: Trade[]
  session: Session
  summaryTrades: Trade[]

  ticketDraft: TicketDraft | null
  /** which screen is showing: the replay terminal or guided drills */
  view: 'replay' | 'drills'
  panelTab: PanelTab
  panelOpen: boolean
  modal: Modal
  toast: { msg: string; kind: 'info' | 'good' | 'bad'; id: number } | null

  init: () => Promise<void>
  notify: (msg: string, kind?: 'info' | 'good' | 'bad') => void
  set: (p: Partial<State>) => void

  selectDataset: (id: string) => void
  addDataset: (meta: DatasetMeta, candles: Candle[]) => Promise<void>
  removeDataset: (id: string) => void
  setTf: (tf: number) => void
  startAt: (cursor: number) => void
  cutAt: (displayTime: number) => void
  jumpTo: (time: number) => void
  randomStart: () => void
  showAll: () => void
  stepForward: () => boolean
  stepBack: () => void
  togglePlay: () => void

  placeOrder: (r: OrderRequest) => string | null
  closePos: (id: string) => void
  cancelOrder: (id: string) => void
  modifyPosition: (id: string, p: { sl?: number | null; tp?: number | null }) => string | null
  modifyOrder: (id: string, p: { price?: number; sl?: number | null; tp?: number | null }) => string | null
  updateTrade: (id: string, p: { tag?: string; note?: string }) => void
  deleteTrade: (id: string) => void

  addDrawing: (d: Drawing) => void
  updateDrawing: (d: Drawing) => void
  removeDrawing: (id: string) => void
  clearDrawings: () => void

  setAccount: (p: Partial<AccountConfig>) => void
  setSpread: (v: number) => void
  resetAccount: () => void
  finishSession: () => void
  exportJson: () => string
  importJson: (text: string) => Promise<void>
}

const newSession = (balance: number, datasetId: string): Session => ({ id: uid(), startedAt: Date.now(), startBalance: balance, datasetId, barsPlayed: 0 })

const defaultAccount: AccountConfig = { startBalance: 500, currency: '$', commissionPct: 0, spreads: {} }

export const useStore = create<State>((set, get) => {
  const meta = () => get().datasets.find((d) => d.id === get().activeId)!
  const ctx = (): EngineCtx => {
    const s = get()
    const m = meta()
    return { spread: s.account.spreads[m.id] ?? m.spread, commissionPct: s.account.commissionPct, tf: s.tf, datasetId: m.id, symbol: m.symbol, sessionId: s.session.id }
  }
  const hasOpen = () => get().positions.length > 0 || get().orders.length > 0
  /** Moving the cursor anywhere but one step forward invalidates open trades — ask first. */
  const confirmDiscard = () => {
    if (!hasOpen()) return true
    if (!window.confirm('This discards your open positions and pending orders (they will not be journaled). Continue?')) return false
    set({ positions: [], orders: [] })
    return true
  }
  const defaultCursor = (id: string) => Math.max(1, Math.floor(getCandles(id).length * 0.7))

  return {
    ready: false,
    datasets: [],
    activeId: '',
    tf: 900,
    cursor: 0,
    replay: true,
    playing: false,
    speed: 1,
    tool: 'cursor',
    drawings: {},
    selectedDrawing: null,
    indicators: { ema20: true, ema50: true, ema200: false, rsi: false, volume: true },
    account: defaultAccount,
    balance: defaultAccount.startBalance,
    positions: [],
    orders: [],
    trades: [],
    session: newSession(defaultAccount.startBalance, ''),
    summaryTrades: [],
    ticketDraft: null,
    view: 'replay',
    panelTab: 'trade',
    panelOpen: window.innerWidth >= 768,
    modal: null,
    toast: null,

    set: (p) => set(p),
    notify: (msg, kind = 'info') => set({ toast: { msg, kind, id: Date.now() } }),

    init: async () => {
      const samples = buildSampleDatasets()
      for (const s of samples) candleCache.set(s.meta.id, s.candles)
      let datasets = samples.map((s) => s.meta)
      let patch: Partial<State> = {}
      try {
        const saved = await dbGet<Partial<State> & { custom?: DatasetMeta[] }>('state')
        if (saved) {
          for (const m of saved.custom ?? []) {
            const c = await dbGet<Candle[]>('candles:' + m.id)
            if (c?.length) {
              candleCache.set(m.id, c)
              datasets = [...datasets, m]
            }
          }
          const { custom: _c, ...rest } = saved
          patch = rest
        }
      } catch (e) {
        console.warn('Could not read saved state', e)
      }
      const activeId = patch.activeId && candleCache.has(patch.activeId) ? patch.activeId : datasets[0].id
      const base = getCandles(activeId)
      const m = datasets.find((d) => d.id === activeId)!
      const tf = patch.tf && tfOptions(m.baseTf).includes(patch.tf) ? patch.tf : m.baseTf <= 3600 ? Math.max(3600, m.baseTf) : m.baseTf
      const cursor = patch.cursor && patch.activeId === activeId ? Math.min(patch.cursor, base.length) : Math.max(1, Math.floor(base.length * 0.7))
      const balance = patch.balance ?? defaultAccount.startBalance
      set({ ...patch, datasets, activeId, tf, cursor, balance, session: patch.session ?? newSession(balance, activeId), ready: true })
    },

    selectDataset: (id) => {
      if (id === get().activeId || !confirmDiscard()) return
      const m = get().datasets.find((d) => d.id === id)
      if (!m) return
      history = []
      const opts = tfOptions(m.baseTf)
      set({ activeId: id, tf: opts.includes(get().tf) ? get().tf : opts[0], cursor: defaultCursor(id), replay: true, playing: false, selectedDrawing: null, tool: 'cursor' })
    },

    addDataset: async (m, candles) => {
      candleCache.set(m.id, candles)
      await dbSet('candles:' + m.id, candles)
      set({ datasets: [...get().datasets.filter((d) => d.id !== m.id), m] })
      get().selectDataset(m.id)
    },

    removeDataset: (id) => {
      const s = get()
      if (id === s.activeId) s.selectDataset(s.datasets[0].id)
      if (get().activeId === id) return
      candleCache.delete(id)
      void dbDel('candles:' + id)
      const drawings = { ...get().drawings }
      delete drawings[id]
      set({ datasets: get().datasets.filter((d) => d.id !== id), drawings })
    },

    setTf: (tf) => set({ tf }),

    startAt: (cursor) => {
      if (!confirmDiscard()) return
      history = []
      const len = getCandles(get().activeId).length
      set({ cursor: Math.min(len, Math.max(1, cursor)), replay: true, playing: false, tool: 'cursor' })
    },
    cutAt: (displayTime) => get().startAt(countBefore(getCandles(get().activeId), displayTime + get().tf)),
    jumpTo: (time) => get().startAt(countBefore(getCandles(get().activeId), time)),
    randomStart: () => {
      const len = getCandles(get().activeId).length
      get().startAt(Math.floor(len * (0.2 + Math.random() * 0.65)))
    },
    showAll: () => {
      if (!confirmDiscard()) return
      history = []
      set({ replay: false, playing: false })
    },

    stepForward: () => {
      const s = get()
      if (!s.replay) return false
      const base = getCandles(s.activeId)
      if (s.cursor >= base.length) {
        set({ playing: false })
        s.notify('End of the data — nothing left to reveal.')
        return false
      }
      history.push({ cursor: s.cursor, balance: s.balance, positions: s.positions, orders: s.orders, tradesLen: s.trades.length })
      if (history.length > 3000) history.shift()

      // Reveal base candles until the displayed candle is complete. Orders are
      // evaluated on every base candle, so fills stay accurate on higher timeframes.
      const c = ctx()
      let st = { balance: s.balance, positions: s.positions, orders: s.orders }
      const closed: Trade[] = []
      let i = s.cursor
      do {
        const r = processCandle(st, base[i], c)
        st = { balance: r.balance, positions: r.positions, orders: r.orders }
        closed.push(...r.trades)
        i++
      } while (i < base.length && bucketOf(base[i].time, s.tf) === bucketOf(base[i - 1].time, s.tf))

      set({ cursor: i, ...st, trades: closed.length ? [...s.trades, ...closed] : s.trades, session: { ...s.session, barsPlayed: s.session.barsPlayed + 1 } })
      for (const t of closed) {
        const label = t.reason === 'tp' ? 'Take profit hit' : 'Stop loss hit'
        s.notify(`${label} · ${fmtMoney(t.pnl, s.account.currency, true)} (${fmtR(t.realizedR)})`, t.pnl >= 0 ? 'good' : 'bad')
      }
      return true
    },

    stepBack: () => {
      const s = get()
      if (!s.replay) return
      const snap = history.pop()
      if (snap) {
        set({ cursor: snap.cursor, balance: snap.balance, positions: snap.positions, orders: snap.orders, trades: s.trades.slice(0, snap.tradesLen), playing: false })
        return
      }
      if (hasOpen()) return s.notify('Cannot rewind further with trades open.')
      const base = getCandles(s.activeId)
      let i = s.cursor - 1
      if (i < 1) return
      const b = bucketOf(base[i].time, s.tf)
      while (i > 1 && bucketOf(base[i - 1].time, s.tf) === b) i--
      set({ cursor: i, playing: false })
    },

    togglePlay: () => {
      const s = get()
      if (!s.replay) return s.notify('Start a replay first — use Cut or Jump to date.')
      set({ playing: !s.playing })
    },

    placeOrder: (r) => {
      const s = get()
      if (!s.replay) return 'Start a replay before trading.'
      const last = lastCandle()
      if (!last) return 'No price yet.'
      if (!(r.qty > 0)) return 'Size must be greater than zero.'
      const ref = r.kind === 'market' ? last.close : r.price
      if (ref == null || !(ref > 0)) return 'Enter an order price.'
      if (r.kind === 'limit' && (r.dir === 1 ? ref >= last.close : ref <= last.close))
        return r.dir === 1 ? 'A buy limit must sit below the current price.' : 'A sell limit must sit above the current price.'
      if (r.kind === 'stop' && (r.dir === 1 ? ref <= last.close : ref >= last.close))
        return r.dir === 1 ? 'A buy stop must sit above the current price.' : 'A sell stop must sit below the current price.'
      if (r.sl != null && (r.dir === 1 ? r.sl >= ref : r.sl <= ref)) return r.dir === 1 ? 'Stop loss must be below entry for a long.' : 'Stop loss must be above entry for a short.'
      if (r.tp != null && (r.dir === 1 ? r.tp <= ref : r.tp >= ref)) return r.dir === 1 ? 'Take profit must be above entry for a long.' : 'Take profit must be below entry for a short.'

      if (r.kind === 'market') {
        const pos = openPosition({ dir: r.dir, qty: r.qty, level: last.close, sl: r.sl, tp: r.tp, tag: r.tag, note: r.note, time: last.time }, equity(s), ctx())
        set({ positions: [...s.positions, pos] })
      } else {
        const o: Order = { id: uid(), type: r.kind, dir: r.dir, qty: r.qty, price: ref, sl: r.sl, tp: r.tp, tag: r.tag, note: r.note, createdTime: last.time, tf: s.tf }
        set({ orders: [...s.orders, o] })
      }
      return null
    },

    closePos: (id) => {
      const s = get()
      const pos = s.positions.find((p) => p.id === id)
      const last = lastCandle()
      if (!pos || !last) return
      const t = closePosition(pos, last.close, last.time, 'manual', s.balance, ctx())
      set({ positions: s.positions.filter((p) => p.id !== id), balance: t.balanceAfter, trades: [...s.trades, t] })
      s.notify(`Closed · ${fmtMoney(t.pnl, s.account.currency, true)} (${fmtR(t.realizedR)})`, t.pnl >= 0 ? 'good' : 'bad')
    },

    cancelOrder: (id) => set({ orders: get().orders.filter((o) => o.id !== id) }),

    modifyPosition: (id, p) => {
      const s = get()
      const pos = s.positions.find((x) => x.id === id)
      const last = lastCandle()
      if (!pos || !last) return 'Position not found.'
      const sl = p.sl === undefined ? pos.sl : p.sl
      const tp = p.tp === undefined ? pos.tp : p.tp
      if (sl != null && (pos.dir === 1 ? sl >= last.close : sl <= last.close)) return 'Stop loss is on the wrong side of the current price.'
      if (tp != null && (pos.dir === 1 ? tp <= last.close : tp >= last.close)) return 'Take profit is on the wrong side of the current price.'
      // widening = more room than the stop the trade was opened with
      const widened = pos.initialSl != null && (sl == null || (pos.dir === 1 ? sl < pos.initialSl : sl > pos.initialSl))
      set({ positions: s.positions.map((x) => (x.id === id ? { ...x, sl, tp, slWidened: x.slWidened || widened } : x)) })
      return null
    },

    modifyOrder: (id, p) => {
      const s = get()
      const o = s.orders.find((x) => x.id === id)
      const last = lastCandle()
      if (!o || !last) return 'Order not found.'
      const n = { ...o, ...p }
      const below = (o.type === 'limit') === (o.dir === 1)
      if (below ? n.price >= last.close : n.price <= last.close) return 'That price would turn the order into a market order.'
      if (n.sl != null && (o.dir === 1 ? n.sl >= n.price : n.sl <= n.price)) return 'Stop loss is on the wrong side of the entry.'
      if (n.tp != null && (o.dir === 1 ? n.tp <= n.price : n.tp >= n.price)) return 'Take profit is on the wrong side of the entry.'
      set({ orders: s.orders.map((x) => (x.id === id ? n : x)) })
      return null
    },

    updateTrade: (id, p) => set({ trades: get().trades.map((t) => (t.id === id ? { ...t, ...p } : t)) }),
    deleteTrade: (id) => {
      history = []
      set({ trades: get().trades.filter((t) => t.id !== id) })
    },

    addDrawing: (d) => {
      const s = get()
      set({ drawings: { ...s.drawings, [s.activeId]: [...(s.drawings[s.activeId] ?? []), d] }, selectedDrawing: d.id, tool: 'cursor' })
    },
    updateDrawing: (d) => {
      const s = get()
      set({ drawings: { ...s.drawings, [s.activeId]: (s.drawings[s.activeId] ?? []).map((x) => (x.id === d.id ? d : x)) } })
    },
    removeDrawing: (id) => {
      const s = get()
      set({ drawings: { ...s.drawings, [s.activeId]: (s.drawings[s.activeId] ?? []).filter((x) => x.id !== id) }, selectedDrawing: null })
    },
    clearDrawings: () => set({ drawings: { ...get().drawings, [get().activeId]: [] }, selectedDrawing: null }),

    setAccount: (p) => set({ account: { ...get().account, ...p } }),
    setSpread: (v) => set({ account: { ...get().account, spreads: { ...get().account.spreads, [get().activeId]: v } } }),
    resetAccount: () => {
      history = []
      const s = get()
      set({ balance: s.account.startBalance, positions: [], orders: [], trades: [], session: newSession(s.account.startBalance, s.activeId), playing: false })
    },

    finishSession: () => {
      const s = get()
      set({ playing: false, summaryTrades: s.trades.filter((t) => t.sessionId === s.session.id), modal: 'summary' })
    },

    exportJson: () => {
      const s = get()
      const custom = s.datasets.filter((d) => d.source !== 'sample').map((m) => ({ meta: m, candles: getCandles(m.id).map((c) => [c.time, c.open, c.high, c.low, c.close, c.volume]) }))
      return JSON.stringify({ app: 'tape-bar-replay', version: 1, exportedAt: new Date().toISOString(), account: s.account, balance: s.balance, trades: s.trades, drawings: s.drawings, indicators: s.indicators, datasets: custom })
    },

    importJson: async (text) => {
      const d = JSON.parse(text)
      if (d?.app !== 'tape-bar-replay') throw new Error('This is not a Tape backup file.')
      history = []
      const s = get()
      let datasets = s.datasets.filter((x) => x.source === 'sample')
      for (const ds of d.datasets ?? []) {
        const candles: Candle[] = ds.candles.map((r: number[]) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5] }))
        candleCache.set(ds.meta.id, candles)
        await dbSet('candles:' + ds.meta.id, candles)
        datasets = [...datasets, ds.meta]
      }
      const account = { ...defaultAccount, ...d.account }
      const balance = d.balance ?? account.startBalance
      const activeId = datasets.some((x) => x.id === s.activeId) ? s.activeId : datasets[0].id
      set({
        datasets, account, balance, trades: d.trades ?? [], drawings: d.drawings ?? {}, indicators: { ...s.indicators, ...d.indicators },
        positions: [], orders: [], playing: false, activeId, cursor: activeId === s.activeId ? s.cursor : defaultCursor(activeId), session: newSession(balance, activeId),
      })
    },
  }
})

/** new session after the summary modal is dismissed */
export function startNewSession() {
  const s = useStore.getState()
  useStore.setState({ session: newSession(s.balance, s.activeId), modal: null, summaryTrades: [] })
}

// ───── selectors that read the candle cache ─────

export function activeMeta(s = useStore.getState()): DatasetMeta | undefined {
  return s.datasets.find((d) => d.id === s.activeId)
}

/** Candles for the chart: aggregated from revealed base candles only. */
export function getDisplay(s = useStore.getState()): Candle[] {
  const base = getCandles(s.activeId)
  return aggregator.get(base, s.activeId, s.tf, s.replay ? Math.min(s.cursor, base.length) : base.length)
}

/** last revealed base candle — the "current" market */
export function lastCandle(s = useStore.getState()): Candle | undefined {
  const base = getCandles(s.activeId)
  return base[(s.replay ? Math.min(s.cursor, base.length) : base.length) - 1]
}

export function equity(s = useStore.getState()): number {
  const last = lastCandle(s)
  if (!last) return s.balance
  return s.balance + s.positions.reduce((a, p) => a + unrealized(p, last.close), 0)
}

export const spreadOf = (s = useStore.getState()) => {
  const m = activeMeta(s)
  return m ? (s.account.spreads[m.id] ?? m.spread) : 0
}

// ───── persistence ─────

let saveTimer: ReturnType<typeof setTimeout> | undefined
useStore.subscribe((s) => {
  if (!s.ready) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { activeId, tf, cursor, replay, speed, drawings, indicators, account, balance, positions, orders, trades, session } = useStore.getState()
    const custom = useStore.getState().datasets.filter((d) => d.source !== 'sample')
    dbSet('state', { activeId, tf, cursor, replay, speed, drawings, indicators, account, balance, positions, orders, trades, session, custom }).catch((e) => console.warn('save failed', e))
  }, 500)
})

// Handy for poking at the app from the console while developing.
if (import.meta.env.DEV) (window as unknown as { tape: unknown }).tape = { useStore, getCandles, getDisplay, lastCandle, equity }
