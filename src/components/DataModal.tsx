import { useRef, useState } from 'react'
import { Check, FileUp, Loader2, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import type { DatasetMeta } from '../lib/types'
import { fetchKlines, guessDecimals, MAX_CANDLES } from '../lib/binance'
import { parseCsv } from '../lib/csv'
import { fmtTime, fromInputDate, tfLabel, tfOptions, uid } from '../lib/format'
import { Modal } from './ui'

type Tab = 'library' | 'binance' | 'csv'
const SOURCE = { sample: 'Built-in · synthetic', binance: 'Binance', csv: 'CSV import' }

export function DataModal() {
  const [tab, setTab] = useState<Tab>('library')
  const close = () => useStore.setState({ modal: null })
  return (
    <Modal title="Market data" onClose={close}>
      <div className="seg mb-4 w-full">
        <button className="flex-1" data-on={tab === 'library'} onClick={() => setTab('library')}>Library</button>
        <button className="flex-1" data-on={tab === 'binance'} onClick={() => setTab('binance')}>Fetch from Binance</button>
        <button className="flex-1" data-on={tab === 'csv'} onClick={() => setTab('csv')}>Import CSV</button>
      </div>
      {tab === 'library' && <Library onPick={close} />}
      {tab === 'binance' && <Binance onDone={close} />}
      {tab === 'csv' && <Csv onDone={close} />}
    </Modal>
  )
}

function Library({ onPick }: { onPick: () => void }) {
  const datasets = useStore((s) => s.datasets)
  const activeId = useStore((s) => s.activeId)
  const s = useStore.getState()
  return (
    <>
      <ul className="space-y-1.5">
        {datasets.map((d) => (
          <li key={d.id} className={`flex items-center gap-1 rounded-lg border ${d.id === activeId ? 'border-amber/50 bg-amber/5' : 'border-line'}`}>
            <button className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left" onClick={() => { s.selectDataset(d.id); onPick() }}>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold text-ink">{d.symbol}</span>
                <span className="block truncate text-[11px] text-muted">{SOURCE[d.source]} · {tfOptions(d.baseTf).map(tfLabel).join(' ')}</span>
              </span>
              <span className="num text-right text-[11px] text-muted">
                <span className="block">{d.count.toLocaleString()} bars</span>
                <span className="block">{fmtTime(d.from, false)} → {fmtTime(d.to, false)}</span>
              </span>
              {d.id === activeId && <Check size={15} className="shrink-0 text-amber" />}
            </button>
            {d.source !== 'sample' && (
              <button className="btn-ghost mr-1 h-8 w-8 text-down" title="Delete dataset" onClick={() => window.confirm(`Delete ${d.symbol} and its drawings?`) && s.removeDataset(d.id)}><Trash2 size={14} /></button>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Built-in datasets are generated price series that behave like their market (sessions, gaps, volatility clusters) so the app works offline. They are not real history — fetch from Binance or import a CSV for that.
      </p>
    </>
  )
}

function Binance({ onDone }: { onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [tf, setTf] = useState(900)
  const [from, setFrom] = useState(new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10))
  const [to, setTo] = useState(today)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  const bars = Math.max(0, Math.round((fromInputDate(to) - fromInputDate(from)) / tf))
  const run = async () => {
    setBusy(true)
    setError('')
    setProgress(0)
    try {
      const sym = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
      const candles = await fetchKlines(sym, tf, fromInputDate(from), fromInputDate(to) + 86400, setProgress)
      const quote = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'BNB', 'EUR', 'TRY', 'IDR'].find((q) => sym.endsWith(q))
      const meta: DatasetMeta = {
        id: `binance-${sym}-${tf}-${uid()}`, symbol: quote ? `${sym.slice(0, -quote.length)}/${quote}` : sym, name: `${sym} · Binance`, source: 'binance',
        baseTf: tf, decimals: guessDecimals(candles), lotSize: 1, spread: 0, count: candles.length, from: candles[0].time, to: candles[candles.length - 1].time,
      }
      await useStore.getState().addDataset(meta, candles)
      useStore.getState().notify(`${meta.symbol}: ${candles.length.toLocaleString()} candles saved for offline use.`, 'good')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label">Pair</label>
          <input className="input uppercase" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="BTCUSDT" list="pairs" />
          <datalist id="pairs">{['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'PAXGUSDT'].map((p) => <option key={p} value={p} />)}</datalist>
        </div>
        <div>
          <label className="label">Lowest timeframe</label>
          <select className="input" value={tf} onChange={(e) => setTf(Number(e.target.value))}>
            {[900, 3600, 14400, 86400].map((t) => <option key={t} value={t}>{tfLabel(t)}</option>)}
          </select>
        </div>
        <div>
          <label className="label">From</label>
          <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className="label">To</label>
          <input className="input" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      <p className="text-[11px] text-muted">
        About {bars.toLocaleString()} candles{bars > MAX_CANDLES ? ` — only the first ${MAX_CANDLES.toLocaleString()} will be kept; shorten the range or use a higher timeframe` : ''}. Higher timeframes are built from this one during replay. Uses Binance's public market-data API; nothing is sent besides the pair and dates.
      </p>
      {error && <p className="rounded-md border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">{error}</p>}
      <button className="btn w-full border-amber/50 bg-amber/15 text-amber" disabled={busy || !symbol.trim() || bars <= 0} onClick={run}>
        {busy ? <><Loader2 size={15} className="animate-spin" /> Fetching… {progress.toLocaleString()} candles</> : 'Fetch candles'}
      </button>
    </div>
  )
}

function Csv({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')

  const load = async (file: File) => {
    setError('')
    try {
      const parsed = parseCsv(await file.text())
      const symbol = (name.trim() || file.name.replace(/\.[^.]+$/, '').split(/[_,\s]/)[0]).toUpperCase().slice(0, 16)
      const c = parsed.candles
      const meta: DatasetMeta = {
        id: `csv-${uid()}`, symbol, name: file.name, source: 'csv', baseTf: parsed.baseTf, decimals: parsed.decimals, lotSize: 1, spread: 0,
        count: c.length, from: c[0].time, to: c[c.length - 1].time,
      }
      await useStore.getState().addDataset(meta, c)
      useStore.getState().notify(`${symbol}: ${c.length.toLocaleString()} ${tfLabel(parsed.baseTf)} candles imported.`, 'good')
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="label">Symbol name (optional)</label>
        <input className="input uppercase" value={name} onChange={(e) => setName(e.target.value)} placeholder="taken from the file name" />
      </div>
      <button
        className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-8 text-muted hover:border-amber/60 hover:text-ink"
        onClick={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void load(f) }}
      >
        <FileUp size={22} />
        <span className="text-[13px] text-ink">Choose an OHLCV file, or drop it here</span>
        <span className="text-[11px]">.csv or .txt</span>
      </button>
      <input ref={input} type="file" accept=".csv,.txt,text/csv,text/plain" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f); e.target.value = '' }} />
      {error && <p className="rounded-md border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">{error}</p>}
      <ul className="space-y-1 text-[11px] leading-relaxed text-muted">
        <li><b className="text-text">TradingView</b> — "Export chart data": <span className="num">time,open,high,low,close,Volume</span></li>
        <li><b className="text-text">MT4</b> — History Center export: <span className="num">2024.01.31,13:45,o,h,l,c,vol</span></li>
        <li><b className="text-text">MT5</b> — "Export bars": tab-separated <span className="num">&lt;DATE&gt; &lt;TIME&gt; &lt;OPEN&gt;…</span></li>
        <li>The file's bar size becomes the lowest timeframe; 1H / 4H / 1D are aggregated from it automatically. Times are read as UTC.</li>
      </ul>
    </div>
  )
}
