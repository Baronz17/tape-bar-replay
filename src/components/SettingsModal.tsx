import { useRef, useState } from 'react'
import { Download, RotateCcw, Upload } from 'lucide-react'
import { activeMeta, spreadOf, useStore } from '../store'
import { fmtMoney } from '../lib/format'
import { Modal, NumInput } from './ui'

const PRESETS = [
  { label: '$500', currency: '$', balance: 500 },
  { label: '$10,000', currency: '$', balance: 10000 },
  { label: 'Rp 5.000.000', currency: 'Rp', balance: 5_000_000 },
  { label: 'Rp 100.000.000', currency: 'Rp', balance: 100_000_000 },
]

export function SettingsModal() {
  const account = useStore((s) => s.account)
  const balance = useStore((s) => s.balance)
  const meta = useStore((s) => activeMeta(s))
  const spread = useStore((s) => spreadOf(s))
  const tradeCount = useStore((s) => s.trades.length)
  const [start, setStart] = useState<number | null>(account.startBalance)
  const [currency, setCurrency] = useState(account.currency)
  const file = useRef<HTMLInputElement>(null)
  const s = useStore.getState()
  const close = () => useStore.setState({ modal: null })

  const reset = () => {
    if (!start || start <= 0) return s.notify('Enter a starting balance above zero.', 'bad')
    if (!window.confirm(`Reset the demo account to ${fmtMoney(start, currency)}?\n\nThis closes open trades and clears the journal (${tradeCount} trades). Export a backup first if you want to keep them.`)) return
    s.setAccount({ startBalance: start, currency: currency.trim() || '$' })
    s.resetAccount()
    s.notify('Demo account reset.', 'good')
  }

  const exportBackup = () => {
    const url = URL.createObjectURL(new Blob([s.exportJson()], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `tape-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const importBackup = async (f: File) => {
    if (!window.confirm('Importing replaces the current account, journal, drawings and imported datasets. Continue?')) return
    try {
      await s.importJson(await f.text())
      s.notify('Backup restored.', 'good')
      close()
    } catch (e) {
      s.notify(e instanceof Error ? e.message : 'Could not read that file.', 'bad')
    }
  }

  return (
    <Modal title="Account & settings" onClose={close}>
      <Section title="Demo wallet" hint={`Current balance ${fmtMoney(balance, account.currency)}`}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.label} className="num h-7 rounded-md border border-line px-2.5 text-xs text-text hover:bg-raised" onClick={() => { setStart(p.balance); setCurrency(p.currency) }}>{p.label}</button>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <div>
            <label className="label">Starting balance</label>
            <NumInput value={start} onChange={setStart} />
          </div>
          <div>
            <label className="label">Currency</label>
            <input className="input" value={currency} maxLength={4} onChange={(e) => setCurrency(e.target.value)} />
          </div>
        </div>
        <button className="btn mt-2 w-full" onClick={reset}><RotateCcw size={14} /> Apply &amp; reset account</button>
        <p className="mt-2 text-[11px] text-muted">Profit and loss are counted in the chart's quote currency and shown with this symbol — there is no currency conversion and no margin limit.</p>
      </Section>

      <Section title="Trading costs">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Spread · {meta?.symbol} (price units)</label>
            <NumInput value={spread} onChange={(v) => s.setSpread(Math.max(0, v ?? 0))} />
          </div>
          <div>
            <label className="label">Commission (% per side)</label>
            <NumInput value={account.commissionPct} onChange={(v) => s.setAccount({ commissionPct: Math.max(0, v ?? 0) })} />
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted">Half the spread is applied against you on entry and again on exit. Commission is charged on the notional value of each side.</p>
      </Section>

      <Section title="Backup" hint="Everything is stored on this device only">
        <div className="grid grid-cols-2 gap-2">
          <button className="btn" onClick={exportBackup}><Download size={14} /> Export JSON</button>
          <button className="btn" onClick={() => file.current?.click()}><Upload size={14} /> Import JSON</button>
        </div>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void importBackup(f); e.target.value = '' }} />
      </Section>

      <Section title="Keyboard">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          {[['→', 'Reveal the next candle'], ['←', 'Step back (undoes fills from that candle)'], ['Space', 'Play / pause'], ['Del', 'Delete the selected drawing'], ['Esc', 'Back to the select tool']].map(([k, v]) => (
            <div key={k} className="contents">
              <dt><kbd className="num rounded border border-line bg-bg px-1.5 py-0.5 text-[11px] text-ink">{k}</kbd></dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
    </Modal>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5 last:mb-0">
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text">{title}</h3>
        {hint && <span className="num text-[11px] text-muted">{hint}</span>}
      </div>
      {children}
    </section>
  )
}
