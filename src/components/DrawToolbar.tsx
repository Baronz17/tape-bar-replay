import { useState } from 'react'
import { Eraser, Minus, MousePointer2, MoveUpRight, PencilRuler, RectangleHorizontal, TrendingDown, TrendingUp, Slash, X } from 'lucide-react'
import { useStore } from '../store'
import type { Tool } from '../lib/types'

const TOOLS: { id: Tool; label: string; icon: typeof Minus; tone?: string }[] = [
  { id: 'cursor', label: 'Select / move', icon: MousePointer2 },
  { id: 'hline', label: 'Horizontal line — support / resistance', icon: Minus },
  { id: 'trend', label: 'Trendline', icon: Slash },
  { id: 'ray', label: 'Ray', icon: MoveUpRight },
  { id: 'rect', label: 'Zone — supply / demand, order block', icon: RectangleHorizontal },
  { id: 'long', label: 'Long position (risk : reward)', icon: TrendingUp, tone: 'text-up' },
  { id: 'short', label: 'Short position (risk : reward)', icon: TrendingDown, tone: 'text-down' },
]

function Buttons({ onPick }: { onPick?: () => void }) {
  const tool = useStore((s) => s.tool)
  const count = useStore((s) => s.drawings[s.activeId]?.length ?? 0)
  return (
    <>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`btn-ghost h-9 w-9 shrink-0 ${tool !== t.id && t.tone ? t.tone : ''}`}
          data-on={tool === t.id}
          title={t.label}
          aria-label={t.label}
          onClick={() => {
            useStore.setState({ tool: tool === t.id ? 'cursor' : t.id, selectedDrawing: null })
            onPick?.()
          }}
        >
          <t.icon size={17} />
        </button>
      ))}
      <span className="my-1 h-px w-6 shrink-0 bg-line" />
      <button
        className="btn-ghost h-9 w-9 shrink-0"
        disabled={!count}
        title="Remove all drawings on this symbol"
        aria-label="Remove all drawings"
        onClick={() => window.confirm(`Remove all ${count} drawings on this symbol?`) && useStore.getState().clearDrawings()}
      >
        <Eraser size={17} />
      </button>
    </>
  )
}

export function DrawToolbar() {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-line bg-panel py-2">
      <Buttons />
    </div>
  )
}

/** Mobile: a single button on the chart that unfolds the tool list. */
export function DrawFloat() {
  const [open, setOpen] = useState(false)
  const tool = useStore((s) => s.tool)
  const Active = TOOLS.find((t) => t.id === tool)?.icon ?? PencilRuler
  const drawing = tool !== 'cursor' && tool !== 'cut'
  return (
    <div className="absolute left-2 top-9 z-20 flex flex-col items-center gap-0.5 rounded-lg border border-line bg-panel/95 p-0.5 shadow-xl backdrop-blur">
      <button className="btn-ghost h-9 w-9" data-on={drawing} onClick={() => setOpen(!open)} aria-label="Drawing tools">
        {open ? <X size={17} /> : drawing ? <Active size={17} /> : <PencilRuler size={17} />}
      </button>
      {open && <Buttons onPick={() => setOpen(false)} />}
    </div>
  )
}
