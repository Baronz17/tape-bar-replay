import { useMemo } from 'react'
import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react'
import { startNewSession, useStore } from '../store'
import { computeStats, reviewBehaviour } from '../lib/stats'
import { fmtMoney, fmtR } from '../lib/format'
import { Modal } from './ui'
import { StatsGrid } from './Dashboard'

export function SessionSummary() {
  const trades = useStore((s) => s.summaryTrades)
  const session = useStore((s) => s.session)
  const currency = useStore((s) => s.account.currency)
  const open = useStore((s) => s.positions.length + s.orders.length)
  const st = useMemo(() => computeStats(trades, session.startBalance), [trades, session.startBalance])
  const findings = useMemo(() => reviewBehaviour(trades), [trades])
  const minutes = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000))
  const keepGoing = () => useStore.setState({ modal: null })

  return (
    <Modal title="Replay session summary" onClose={keepGoing}>
      <div className="mb-4 flex items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <div className="text-[11px] text-muted">Session result</div>
          <div className={`num text-3xl font-medium leading-tight ${st.net > 0 ? 'text-up' : st.net < 0 ? 'text-down' : 'text-ink'}`}>{fmtMoney(st.net, currency, true)}</div>
          <div className="num text-xs text-muted">{fmtR(st.totalR)} across {st.count} trade{st.count === 1 ? '' : 's'}</div>
        </div>
        <div className="num text-right text-xs text-muted">
          <div>{session.barsPlayed.toLocaleString()} candles replayed</div>
          <div>{minutes} min of practice</div>
        </div>
      </div>

      {!st.count ? (
        <p className="py-6 text-center text-[13px] text-muted">No trades were closed in this session.</p>
      ) : (
        <>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text">Behaviour review</h3>
          <ul className="mb-5 space-y-2">
            {findings.map((f) => {
              const Icon = f.level === 'bad' ? OctagonAlert : f.level === 'warn' ? TriangleAlert : CircleCheck
              const tone = f.level === 'bad' ? 'text-down border-down/30 bg-down/5' : f.level === 'warn' ? 'text-amber border-amber/30 bg-amber/5' : 'text-up border-up/30 bg-up/5'
              return (
                <li key={f.title} className={`flex gap-3 rounded-lg border px-3 py-2.5 ${tone}`}>
                  <Icon size={16} className="mt-0.5 shrink-0" />
                  <div>
                    <div className="text-[13px] font-medium">{f.title}</div>
                    <div className="mt-0.5 text-xs text-text">{f.detail}</div>
                  </div>
                </li>
              )
            })}
          </ul>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text">Numbers</h3>
          <StatsGrid st={st} currency={currency} />
        </>
      )}

      {open > 0 && <p className="mt-4 text-xs text-amber">You still have {open} open trade{open === 1 ? '' : 's'} — they carry over and will be counted in the session where they close.</p>}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button className="btn" onClick={keepGoing}>Keep going</button>
        <button className="btn border-amber/50 bg-amber/15 text-amber" onClick={startNewSession}>End &amp; start new session</button>
      </div>
    </Modal>
  )
}
