import { useState } from 'react'
import { ChevronDown, Download, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { STRATEGY_TAGS, type Trade } from '../lib/types'
import { fmtMoney, fmtPrice, fmtQty, fmtR, fmtTime, tfLabel } from '../lib/format'
import { Empty } from './ui'

export type Scope = 'session' | 'symbol' | 'all'

export function useScopedTrades(scope: Scope): Trade[] {
  const trades = useStore((s) => s.trades)
  const sessionId = useStore((s) => s.session.id)
  const activeId = useStore((s) => s.activeId)
  if (scope === 'session') return trades.filter((t) => t.sessionId === sessionId)
  if (scope === 'symbol') return trades.filter((t) => t.datasetId === activeId)
  return trades
}

export function ScopePicker({ scope, onChange }: { scope: Scope; onChange: (s: Scope) => void }) {
  return (
    <div className="seg">
      <button data-on={scope === 'session'} onClick={() => onChange('session')}>This session</button>
      <button data-on={scope === 'symbol'} onClick={() => onChange('symbol')}>This symbol</button>
      <button data-on={scope === 'all'} onClick={() => onChange('all')}>All</button>
    </div>
  )
}

const REASON = { tp: 'Take profit', sl: 'Stop loss', manual: 'Closed by hand' }

function downloadCsv(trades: Trade[]) {
  const head = 'symbol,timeframe,direction,qty,entry_time_utc,exit_time_utc,entry,exit,initial_sl,tp,planned_rr,realized_r,net_pnl,commission,risk_pct,exit_reason,strategy,note'
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`
  const rows = trades.map((t) =>
    [t.symbol, tfLabel(t.tf), t.dir === 1 ? 'long' : 'short', t.qty, fmtTime(t.entryTime), fmtTime(t.exitTime), t.entry, t.exit, t.initialSl ?? '', t.tp ?? '', t.plannedRR?.toFixed(2) ?? '', t.realizedR?.toFixed(2) ?? '', t.pnl.toFixed(2), t.commission.toFixed(2), t.riskPct.toFixed(2), t.reason, q(t.tag), q(t.note)].join(','),
  )
  const url = URL.createObjectURL(new Blob([[head, ...rows].join('\n')], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `tape-journal-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function Journal() {
  const [scope, setScope] = useState<Scope>('session')
  const [open, setOpen] = useState<string | null>(null)
  const trades = useScopedTrades(scope)
  const currency = useStore((s) => s.account.currency)
  const datasets = useStore((s) => s.datasets)
  const s = useStore.getState()
  const decOf = (id: string) => datasets.find((d) => d.id === id)?.decimals ?? 2

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <ScopePicker scope={scope} onChange={setScope} />
        <button className="btn-ghost h-8 w-8" disabled={!trades.length} title="Download these trades as CSV" onClick={() => downloadCsv(trades)}><Download size={15} /></button>
      </div>
      {!trades.length ? (
        <Empty title="No closed trades yet">Every trade you close during a replay is logged here automatically, with its planned and realised R.</Empty>
      ) : (
        <ul className="space-y-1.5">
          {[...trades].reverse().map((t) => {
            const dec = decOf(t.datasetId)
            const isOpen = open === t.id
            const win = t.pnl >= 0
            return (
              <li key={t.id} className="card overflow-hidden">
                <button className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left" onClick={() => setOpen(isOpen ? null : t.id)}>
                  <span className={`h-8 w-0.5 shrink-0 rounded ${win ? 'bg-up' : 'bg-down'}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[13px] text-ink">
                      <b className="font-semibold">{t.symbol}</b>
                      <span className={t.dir === 1 ? 'text-up' : 'text-down'}>{t.dir === 1 ? 'Long' : 'Short'}</span>
                      <span className="text-muted">{tfLabel(t.tf)}</span>
                    </span>
                    <span className="block truncate text-[11px] text-muted">{t.tag} · {REASON[t.reason]} · {fmtTime(t.exitTime)}</span>
                  </span>
                  <span className="text-right">
                    <span className={`num block text-[13px] font-medium ${win ? 'text-up' : 'text-down'}`}>{fmtMoney(t.pnl, currency, true)}</span>
                    <span className="num block text-[11px] text-muted">{fmtR(t.realizedR)}</span>
                  </span>
                  <ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                {isOpen && (
                  <div className="border-t border-line bg-bg/50 p-3">
                    <dl className="num grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      <Cell k="Entry" v={`${fmtPrice(t.entry, dec)}`} sub={fmtTime(t.entryTime)} />
                      <Cell k="Exit" v={`${fmtPrice(t.exit, dec)}`} sub={fmtTime(t.exitTime)} />
                      <Cell k="Planned R:R" v={t.plannedRR != null ? `1 : ${t.plannedRR.toFixed(2)}` : '—'} />
                      <Cell k="Realised" v={fmtR(t.realizedR)} />
                      <Cell k="Size" v={fmtQty(t.qty)} />
                      <Cell k="Risk taken" v={t.initialSl != null ? `${t.riskPct.toFixed(2)}%` : 'no stop'} />
                      <Cell k="Stop / target" v={`${fmtPrice(t.initialSl, dec)} / ${fmtPrice(t.tp, dec)}`} />
                      <Cell k="Fees" v={fmtMoney(t.commission, currency)} />
                    </dl>
                    {t.slWidened && <p className="mt-2 text-[11px] text-amber">Stop was moved further away during this trade.</p>}
                    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                      <select className="input !h-8" value={t.tag} onChange={(e) => s.updateTrade(t.id, { tag: e.target.value })}>
                        {STRATEGY_TAGS.map((x) => <option key={x}>{x}</option>)}
                      </select>
                      <button className="btn-ghost h-8 w-8 text-down" title="Delete this trade from the journal" onClick={() => window.confirm('Delete this trade from the journal? Statistics will change.') && s.deleteTrade(t.id)}><Trash2 size={14} /></button>
                    </div>
                    <textarea className="input mt-2" rows={2} placeholder="Notes — what did you see, what would you do differently?" value={t.note} onChange={(e) => s.updateTrade(t.id, { note: e.target.value })} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

const Cell = ({ k, v, sub }: { k: string; v: string; sub?: string }) => (
  <div>
    <dt className="font-sans text-[11px] text-muted">{k}</dt>
    <dd className="text-ink">{v}{sub && <span className="block text-[10.5px] text-muted">{sub}</span>}</dd>
  </div>
)
