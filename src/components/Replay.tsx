import { useState } from 'react'
import { CalendarClock, ChevronDown, Ellipsis, ChevronUp, Eye, Flag, Pause, Play, Scissors, Shuffle, StepBack, StepForward } from 'lucide-react'
import { activeMeta, lastCandle, useStore } from '../store'
import { fmtTime, fromInputDate, toInputDate } from '../lib/format'
import { Popover } from './ui'

const SPEEDS = [1, 2, 5, 10]

function JumpForm({ onDone }: { onDone: () => void }) {
  const meta = useStore((s) => activeMeta(s))
  const last = useStore((s) => lastCandle(s))
  const [v, setV] = useState(() => toInputDate(last?.time ?? meta?.from ?? 0))
  if (!meta) return null
  return (
    <form
      className="w-[236px] p-1"
      onSubmit={(e) => {
        e.preventDefault()
        const t = fromInputDate(v)
        if (isFinite(t)) useStore.getState().jumpTo(t)
        onDone()
      }}
    >
      <label className="label">Start replay at (UTC)</label>
      <input className="input" type="datetime-local" value={v} min={toInputDate(meta.from)} max={toInputDate(meta.to)} onChange={(e) => setV(e.target.value)} />
      <p className="mt-1.5 text-[11px] text-muted">Data: {fmtTime(meta.from, false)} → {fmtTime(meta.to, false)}</p>
      <button className="btn mt-2 w-full border-amber/50 bg-amber/15 text-amber">Jump &amp; hide the future</button>
    </form>
  )
}

function Clock({ short }: { short?: boolean }) {
  const last = useStore((s) => lastCandle(s))
  const replay = useStore((s) => s.replay)
  return (
    <div className="num flex items-center gap-1.5 whitespace-nowrap text-xs text-text" title="Time of the last revealed candle (UTC)">
      <span className={`h-1.5 w-1.5 rounded-full ${replay ? 'bg-amber' : 'bg-muted'}`} />
      {last ? (short ? fmtTime(last.time).slice(5) : fmtTime(last.time)) : '—'}
    </div>
  )
}

function Transport({ big }: { big?: boolean }) {
  const playing = useStore((s) => s.playing)
  const replay = useStore((s) => s.replay)
  const speed = useStore((s) => s.speed)
  const s = useStore.getState()
  const sz = big ? 'h-10 w-10' : 'h-8 w-8'
  return (
    <>
      <button className={`btn-ghost ${sz}`} disabled={!replay} title="Step back (←)" onClick={s.stepBack}><StepBack size={17} /></button>
      <button
        className={`grid place-items-center rounded-md ${sz} ${playing ? 'bg-amber text-bg' : 'bg-raised text-ink hover:bg-[#232b36]'}`}
        disabled={!replay}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        onClick={s.togglePlay}
      >
        {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
      </button>
      <button className={`btn-ghost ${sz}`} disabled={!replay} title="Step forward (→)" onClick={() => s.stepForward()}><StepForward size={17} /></button>
      <button
        className="num h-8 min-w-[40px] rounded-md px-1.5 text-xs font-medium text-muted hover:bg-raised hover:text-ink"
        title="Playback speed"
        onClick={() => useStore.setState({ speed: SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] })}
      >
        {speed}x
      </button>
    </>
  )
}

/** Desktop: lives in the top bar. */
export function ReplayBar() {
  const tool = useStore((s) => s.tool)
  const replay = useStore((s) => s.replay)
  const s = useStore.getState()
  return (
    <div className="flex items-center gap-1">
      <button className="btn-ghost h-8 gap-1.5 px-2 text-xs" data-on={tool === 'cut'} title="Cut the chart at a candle" onClick={() => useStore.setState({ tool: tool === 'cut' ? 'cursor' : 'cut' })}>
        <Scissors size={15} /> <span className="hidden xl:inline">Cut</span>
      </button>
      <Popover button={(open, toggle) => <button className="btn-ghost h-8 gap-1.5 px-2 text-xs" data-on={open} onClick={toggle}><CalendarClock size={15} /> <span className="hidden xl:inline">Jump</span></button>}>
        {(close) => <JumpForm onDone={close} />}
      </Popover>
      <button className="btn-ghost h-8 gap-1.5 px-2 text-xs" title="Start at a random point — no peeking" onClick={s.randomStart}><Shuffle size={15} /> <span className="hidden xl:inline">Random</span></button>
      <span className="mx-1 h-5 w-px bg-line" />
      <Transport />
      <span className="mx-1 h-5 w-px bg-line" />
      <Clock />
      {replay && (
        <button className="btn-ghost ml-1 h-8 gap-1.5 px-2 text-xs" title="Leave replay and show all candles" onClick={s.showAll}><Eye size={15} /> <span className="hidden xl:inline">Show all</span></button>
      )}
    </div>
  )
}

/** Mobile: floating, collapsible controller above the bottom navigation. */
export function ReplayFloat() {
  const [open, setOpen] = useState(true)
  const [more, setMore] = useState(false)
  const [jump, setJump] = useState(false)
  const tool = useStore((s) => s.tool)
  const playing = useStore((s) => s.playing)
  const s = useStore.getState()

  if (!open)
    return (
      <button className="absolute bottom-3 left-1/2 z-20 flex h-9 -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-panel px-3 shadow-xl" onClick={() => setOpen(true)}>
        {playing ? <Pause size={14} className="text-amber" /> : <Play size={14} />}
        <Clock />
        <ChevronUp size={14} className="text-muted" />
      </button>
    )

  const item = 'flex h-11 flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[10.5px] text-muted active:bg-raised'
  return (
    <div className="absolute inset-x-2 bottom-2 z-20 mx-auto max-w-[420px] rounded-xl border border-line bg-panel/95 shadow-xl backdrop-blur">
      {more && (
        <div className="border-b border-line p-1.5">
          {jump ? (
            <JumpForm onDone={() => { setJump(false); setMore(false) }} />
          ) : (
            <div className="flex gap-1">
              <button className={item} data-on={tool === 'cut'} onClick={() => { useStore.setState({ tool: tool === 'cut' ? 'cursor' : 'cut' }); setMore(false) }}><Scissors size={16} />Cut</button>
              <button className={item} onClick={() => setJump(true)}><CalendarClock size={16} />Jump</button>
              <button className={item} onClick={() => { s.randomStart(); setMore(false) }}><Shuffle size={16} />Random</button>
              <button className={item} onClick={() => { s.showAll(); setMore(false) }}><Eye size={16} />Show all</button>
              <button className={item} onClick={() => { s.finishSession(); setMore(false) }}><Flag size={16} />Finish</button>
            </div>
          )}
        </div>
      )}
      <div className="flex items-center gap-1 p-1.5">
        <Transport big />
        <div className="min-w-0 flex-1 overflow-hidden px-1"><Clock short /></div>
        <button className="btn-ghost h-10 w-9" data-on={more} aria-label="Start point and session options" onClick={() => { setMore(!more); setJump(false) }}><Ellipsis size={18} /></button>
        <button className="btn-ghost h-10 w-8" onClick={() => setOpen(false)} aria-label="Collapse replay controls"><ChevronDown size={16} /></button>
      </div>
    </div>
  )
}
