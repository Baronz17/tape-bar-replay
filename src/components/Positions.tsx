import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { activeMeta, lastCandle, useStore } from '../store'
import { unrealized } from '../lib/engine'
import { fmtMoney, fmtPrice, fmtQty, fmtR, tfLabel } from '../lib/format'
import { Empty } from './ui'

/** Field that only commits a valid change; shows the store's reason when a level is rejected. */
function LevelField({ label, tone, value, onCommit }: { label: string; tone: string; value: number | null; onCommit: (v: number | null) => string | null }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  useEffect(() => setText(value == null ? '' : String(value)), [value])
  // Commit on blur / Enter only — a half-typed price must never become a live stop.
  const commit = () => {
    const v = text.trim() === '' ? null : Number(text)
    if (v === value || (v != null && !isFinite(v))) return setText(value == null ? '' : String(value))
    const err = onCommit(v)
    if (err) {
      useStore.getState().notify(err, 'bad')
      setText(value == null ? '' : String(value))
    }
  }
  return (
    <div>
      <label className={`label ${tone}`}>{label}</label>
      <input
        className="input !h-8"
        type="number"
        inputMode="decimal"
        step="any"
        placeholder="none"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  )
}

export function Positions() {
  const positions = useStore((s) => s.positions)
  const orders = useStore((s) => s.orders)
  const last = useStore((s) => lastCandle(s))
  const meta = useStore((s) => activeMeta(s))
  const currency = useStore((s) => s.account.currency)
  const s = useStore.getState()
  const dec = meta?.decimals ?? 2
  const price = last?.close ?? 0

  if (!positions.length && !orders.length)
    return <Empty title="No open trades">Positions and pending orders appear here. You can also drag their SL / TP lines directly on the chart.</Empty>

  return (
    <div className="space-y-2 p-3">
      {positions.map((p) => {
        const pnl = unrealized(p, price)
        const r = p.riskAmount > 0 ? pnl / p.riskAmount : null
        return (
          <div key={p.id} className="card p-3">
            <div className="flex items-center gap-2">
              <span className={`chip ${p.dir === 1 ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{p.dir === 1 ? 'LONG' : 'SHORT'}</span>
              <span className="num text-xs text-ink">{fmtQty(p.qty)}</span>
              <span className="num text-xs text-muted">@ {fmtPrice(p.entry, dec)}</span>
              <span className="ml-auto text-[11px] text-muted">{p.tag} · {tfLabel(p.tf)}</span>
            </div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className={`num text-lg font-medium ${pnl >= 0 ? 'text-up' : 'text-down'}`}>{fmtMoney(pnl, currency, true)}</span>
              <span className={`num text-sm ${pnl >= 0 ? 'text-up' : 'text-down'}`}>{fmtR(r)}</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <LevelField label="Stop loss" tone="!text-down" value={p.sl} onCommit={(v) => s.modifyPosition(p.id, { sl: v })} />
              <LevelField label="Take profit" tone="!text-up" value={p.tp} onCommit={(v) => s.modifyPosition(p.id, { tp: v })} />
            </div>
            {p.slWidened && <p className="mt-2 text-[11px] text-amber">Stop was moved further than planned — this will be flagged in the session review.</p>}
            <button className="btn mt-2.5 h-8 w-full text-xs" onClick={() => s.closePos(p.id)}>Close at market</button>
          </div>
        )
      })}

      {orders.length > 0 && <p className="px-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted">Pending orders</p>}
      {orders.map((o) => (
        <div key={o.id} className="card flex items-center gap-2 p-3">
          <span className={`chip ${o.dir === 1 ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`}>{o.dir === 1 ? 'BUY' : 'SELL'} {o.type.toUpperCase()}</span>
          <div className="num min-w-0 flex-1 text-xs">
            <div className="text-ink">{fmtQty(o.qty)} @ {fmtPrice(o.price, dec)}</div>
            <div className="text-muted">SL {fmtPrice(o.sl, dec)} · TP {fmtPrice(o.tp, dec)}</div>
          </div>
          <button className="btn-ghost h-8 w-8" title="Cancel order" onClick={() => s.cancelOrder(o.id)}><X size={15} /></button>
        </div>
      ))}
    </div>
  )
}
