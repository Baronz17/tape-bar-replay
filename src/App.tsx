import { useEffect, useRef, useState } from 'react'
import { Activity, BookOpen, GraduationCap, ChartNoAxesCombined, ChevronDown, Flag, ListOrdered, PanelRightClose, PanelRightOpen, Settings, SlidersHorizontal, Ticket } from 'lucide-react'
import { activeMeta, equity, useStore, type PanelTab } from './store'
import { fmtMoney, tfLabel, tfOptions } from './lib/format'
import { ChartView } from './components/ChartView'
import { ReplayBar, ReplayFloat } from './components/Replay'
import { DrawFloat, DrawToolbar } from './components/DrawToolbar'
import { OrderTicket } from './components/OrderTicket'
import { Positions } from './components/Positions'
import { Journal } from './components/Journal'
import { Dashboard } from './components/Dashboard'
import { DataModal } from './components/DataModal'
import { SettingsModal } from './components/SettingsModal'
import { SessionSummary } from './components/SessionSummary'
import { DrillsView } from './components/drills/DrillsView'
import { Popover, Toggle, useIsDesktop } from './components/ui'
import type { Indicators } from './lib/types'

const TABS: { id: PanelTab; label: string; icon: typeof Ticket }[] = [
  { id: 'trade', label: 'Trade', icon: Ticket },
  { id: 'positions', label: 'Open', icon: ListOrdered },
  { id: 'journal', label: 'Journal', icon: BookOpen },
  { id: 'stats', label: 'Stats', icon: ChartNoAxesCombined },
]

function IndicatorList() {
  const ind = useStore((s) => s.indicators)
  const set = (k: keyof Indicators) => (v: boolean) => useStore.setState({ indicators: { ...ind, [k]: v } })
  return (
    <div>
      <Toggle on={ind.ema20} onChange={set('ema20')} label="EMA 20" hint="Short-term trend" swatch="#e8a23a" />
      <Toggle on={ind.ema50} onChange={set('ema50')} label="EMA 50" hint="Medium-term trend" swatch="#5b9cf5" />
      <Toggle on={ind.ema200} onChange={set('ema200')} label="EMA 200" hint="Long-term trend" swatch="#b78cf0" />
      <Toggle on={ind.rsi} onChange={set('rsi')} label="RSI 14" hint="Momentum, in its own pane" />
      <Toggle on={ind.volume} onChange={set('volume')} label="Volume" hint="Bars under the price" />
    </div>
  )
}

function Timeframes() {
  const meta = useStore((s) => activeMeta(s))
  const tf = useStore((s) => s.tf)
  if (!meta) return null
  return (
    <div className="seg shrink-0">
      {tfOptions(meta.baseTf).map((t) => (
        <button key={t} className="max-md:!px-2" data-on={tf === t} onClick={() => useStore.getState().setTf(t)}>{tfLabel(t)}</button>
      ))}
    </div>
  )
}

function SymbolButton() {
  const meta = useStore((s) => activeMeta(s))
  return (
    <button className="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-[13px] font-semibold text-ink hover:bg-raised" onClick={() => useStore.setState({ modal: 'data' })} title="Change symbol / load data">
      {meta?.symbol}
      <ChevronDown size={14} className="text-muted" />
    </button>
  )
}

function EquityBadge() {
  const eq = useStore((s) => equity(s))
  const balance = useStore((s) => s.balance)
  const currency = useStore((s) => s.account.currency)
  const open = eq - balance
  return (
    <button className="shrink-0 rounded-md px-2 py-0.5 text-right hover:bg-raised" onClick={() => useStore.setState({ modal: 'settings' })} title="Demo account">
      <span className="block text-[10px] leading-tight text-muted">Equity</span>
      <span className={`num block text-[13px] font-medium leading-tight ${open > 0 ? 'text-up' : open < 0 ? 'text-down' : 'text-ink'}`}>{fmtMoney(eq, currency)}</span>
    </button>
  )
}

const openDrills = () => useStore.setState({ view: 'drills', playing: false })

function TopBar({ desktop }: { desktop: boolean }) {
  const panelOpen = useStore((s) => s.panelOpen)
  const s = useStore.getState()
  if (!desktop)
    return (
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line bg-panel px-1.5">
        <SymbolButton />
        <div className="min-w-0 flex-1 overflow-x-auto"><Timeframes /></div>
        <EquityBadge />
        <button className="btn-ghost h-9 w-9 shrink-0 text-amber" onClick={openDrills} aria-label="Guided drills"><GraduationCap size={18} /></button>
        <button className="btn-ghost h-9 w-9 shrink-0" onClick={() => useStore.setState({ modal: 'settings' })} aria-label="Settings"><Settings size={17} /></button>
      </header>
    )
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
      <div className="flex items-center gap-1.5 pl-1 pr-2 text-[13px] font-semibold tracking-wide text-ink">
        <Activity size={16} className="text-amber" /> <span className="hidden lg:inline">Tape</span>
      </div>
      <span className="h-5 w-px bg-line" />
      <SymbolButton />
      <Timeframes />
      <span className="h-5 w-px bg-line" />
      <ReplayBar />
      <div className="flex-1" />
      <button className="btn-ghost h-8 gap-1.5 px-2 text-xs text-amber" onClick={openDrills} title="Practice with guided drills"><GraduationCap size={15} /> <span className="hidden xl:inline">Drills</span></button>
      <Popover align="right" button={(open, toggle) => <button className="btn-ghost h-8 gap-1.5 px-2 text-xs" data-on={open} onClick={toggle}><SlidersHorizontal size={15} /> <span className="hidden xl:inline">Indicators</span></button>}>
        {() => <div className="w-[240px]"><IndicatorList /></div>}
      </Popover>
      <button className="btn-ghost h-8 gap-1.5 px-2 text-xs" onClick={s.finishSession} title="Review this practice session"><Flag size={15} /> <span className="hidden xl:inline">Finish session</span></button>
      <span className="h-5 w-px bg-line" />
      <EquityBadge />
      <button className="btn-ghost h-8 w-8" onClick={() => useStore.setState({ modal: 'settings' })} title="Account & settings"><Settings size={16} /></button>
      <button className="btn-ghost h-8 w-8" onClick={() => useStore.setState({ panelOpen: !panelOpen })} title={panelOpen ? 'Hide panel' : 'Show panel'}>
        {panelOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
      </button>
    </header>
  )
}

function PanelBody({ tab }: { tab: PanelTab }) {
  if (tab === 'trade') return <OrderTicket />
  if (tab === 'positions') return <Positions />
  if (tab === 'journal') return <Journal />
  if (tab === 'stats') return <Dashboard />
  return <div className="p-2"><IndicatorList /></div>
}

function OpenCount() {
  const n = useStore((s) => s.positions.length + s.orders.length)
  return n ? <span className="num grid h-4 min-w-4 place-items-center rounded-full bg-amber px-1 text-[10px] font-semibold text-bg">{n}</span> : null
}

function SidePanel() {
  const tab = useStore((s) => s.panelTab)
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-line bg-panel">
      <nav className="flex h-10 shrink-0 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`relative flex flex-1 items-center justify-center gap-1.5 text-xs font-medium ${tab === t.id ? 'text-ink' : 'text-muted hover:text-text'}`}
            onClick={() => useStore.setState({ panelTab: t.id })}
          >
            {t.label}
            {t.id === 'positions' && <OpenCount />}
            {tab === t.id && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-t bg-amber" />}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelBody tab={tab === 'indicators' ? 'trade' : tab} />
      </div>
    </aside>
  )
}

/** Mobile bottom sheet: drag the handle down (or tap the backdrop) to dismiss. */
function Drawer() {
  const tab = useStore((s) => s.panelTab)
  const [dy, setDy] = useState(0)
  const startY = useRef<number | null>(null)
  const close = () => useStore.setState({ panelOpen: false })
  const title = tab === 'indicators' ? 'Indicators' : TABS.find((t) => t.id === tab)?.label
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative flex max-h-[78%] flex-col rounded-t-2xl border-t border-line bg-panel shadow-2xl" style={{ transform: `translateY(${dy}px)`, transition: startY.current == null ? 'transform .18s' : undefined }}>
        <div
          className="shrink-0 cursor-grab touch-none px-4 pb-2 pt-2"
          onPointerDown={(e) => { startY.current = e.clientY; e.currentTarget.setPointerCapture(e.pointerId) }}
          onPointerMove={(e) => startY.current != null && setDy(Math.max(0, e.clientY - startY.current))}
          onPointerUp={() => { startY.current = null; if (dy > 90) close(); setDy(0) }}
          onPointerCancel={() => { startY.current = null; setDy(0) }}
        >
          <div className="mx-auto h-1 w-9 rounded-full bg-line" />
          <div className="mt-2 text-sm font-semibold text-ink">{title}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
          <PanelBody tab={tab} />
        </div>
      </div>
    </div>
  )
}

function BottomNav() {
  const tab = useStore((s) => s.panelTab)
  const open = useStore((s) => s.panelOpen)
  const items = [...TABS, { id: 'indicators' as PanelTab, label: 'Indicators', icon: SlidersHorizontal }]
  return (
    <nav className="z-40 flex shrink-0 border-t border-line bg-panel pb-[env(safe-area-inset-bottom)]">
      {items.map((t) => {
        const on = open && tab === t.id
        return (
          <button
            key={t.id}
            className={`relative flex h-14 flex-1 flex-col items-center justify-center gap-1 text-[10.5px] font-medium ${on ? 'text-amber' : 'text-muted'}`}
            onClick={() => useStore.setState(on ? { panelOpen: false } : { panelOpen: true, panelTab: t.id })}
          >
            <t.icon size={19} />
            {t.label}
            {t.id === 'positions' && <span className="absolute right-[22%] top-1.5"><OpenCount /></span>}
          </button>
        )
      })}
    </nav>
  )
}

function Toast() {
  const toast = useStore((s) => s.toast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => useStore.setState({ toast: null }), 3600)
    return () => clearTimeout(t)
  }, [toast])
  if (!toast) return null
  const tone = toast.kind === 'good' ? 'border-up/50 text-up' : toast.kind === 'bad' ? 'border-down/50 text-down' : 'border-line text-ink'
  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-[60] flex justify-center px-3">
      <div role="status" className={`num max-w-md rounded-lg border bg-panel px-3.5 py-2 text-xs shadow-2xl ${tone}`}>{toast.msg}</div>
    </div>
  )
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const playing = useStore((s) => s.playing)
  const speed = useStore((s) => s.speed)
  const panelOpen = useStore((s) => s.panelOpen)
  const modal = useStore((s) => s.modal)
  const view = useStore((s) => s.view)
  const desktop = useIsDesktop()

  useEffect(() => {
    void useStore.getState().init()
  }, [])

  // auto-play clock
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => useStore.getState().stepForward(), 800 / speed)
    return () => clearInterval(id)
  }, [playing, speed])

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable]')) return
      const s = useStore.getState()
      if (s.modal || s.view !== 'replay') return
      if (e.key === 'ArrowRight') s.stepForward()
      else if (e.key === 'ArrowLeft') s.stepBack()
      else if (e.key === ' ') s.togglePlay()
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedDrawing) s.removeDrawing(s.selectedDrawing)
      else if (e.key === 'Escape') useStore.setState({ tool: 'cursor', selectedDrawing: null })
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])

  if (!ready) return <div className="grid h-full place-items-center text-xs text-muted">Loading market data…</div>
  if (view === 'drills')
    return (
      <>
        <DrillsView />
        <Toast />
      </>
    )

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <TopBar desktop={desktop} />
      <div className="relative flex min-h-0 flex-1">
        {desktop && <DrawToolbar />}
        <main className="relative min-w-0 flex-1">
          <ChartView />
          {!desktop && <DrawFloat />}
          {!desktop && <ReplayFloat />}
        </main>
        {desktop && panelOpen && <SidePanel />}
        {!desktop && panelOpen && <Drawer />}
      </div>
      {!desktop && <BottomNav />}
      {modal === 'data' && <DataModal />}
      {modal === 'settings' && <SettingsModal />}
      {modal === 'summary' && <SessionSummary />}
      <Toast />
    </div>
  )
}
