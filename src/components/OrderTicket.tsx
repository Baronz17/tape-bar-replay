import { useEffect, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { activeMeta, equity, lastCandle, spreadOf, useStore } from '../store'
import { STRATEGY_TAGS, type Dir } from '../lib/types'
import { fmtMoney, fmtPrice, fmtQty, roundTo } from '../lib/format'
import { NumInput } from './ui'

type Kind = 'market' | 'limit' | 'stop'

export function OrderTicket() {
  const meta = useStore((s) => activeMeta(s))
  const last = useStore((s) => lastCandle(s))
  const eq = useStore((s) => equity(s))
  const spread = useStore((s) => spreadOf(s))
  const currency = useStore((s) => s.account.currency)
  const commissionPct = useStore((s) => s.account.commissionPct)
  const replay = useStore((s) => s.replay)
  const draft = useStore((s) => s.ticketDraft)

  const [dir, setDir] = useState<Dir>(1)
  const [kind, setKind] = useState<Kind>('market')
  const [price, setPrice] = useState<number | null>(null)
  const [sl, setSl] = useState<number | null>(null)
  const [tp, setTp] = useState<number | null>(null)
  const [mode, setMode] = useState<'risk' | 'size'>('risk')
  const [riskPct, setRiskPct] = useState<number | null>(1)
  const [manualQty, setManualQty] = useState<number | null>(null)
  const [tag, setTag] = useState(STRATEGY_TAGS[0])
  const [note, setNote] = useState('')

  // A position drawing was sent here from the chart.
  useEffect(() => {
    if (!draft || !meta) return
    const cur = lastCandle()?.close ?? draft.entry
    const d = meta.decimals
    setDir(draft.dir)
    setPrice(roundTo(draft.entry, d))
    setSl(roundTo(draft.sl, d))
    setTp(roundTo(draft.tp, d))
    // below the market a buy is a limit, above it a stop (mirrored for sells)
    setKind((draft.entry < cur) === (draft.dir === 1) ? 'limit' : 'stop')
  }, [draft, meta])

  if (!meta) return null
  const dec = meta.decimals
  const cur = last?.close ?? 0
  const ref = kind === 'market' ? cur : price
  const fill = ref != null ? ref + (dir * spread) / 2 : null
  const stopDist = fill != null && sl != null ? Math.abs(fill - sl) : null

  // position size from risk: (equity × risk%) ÷ distance to stop
  let qty: number | null = null
  if (mode === 'size') qty = manualQty
  else if (stopDist && riskPct) {
    const raw = (eq * riskPct) / 100 / stopDist
    const step = dec === 0 && meta.lotSize > 1 ? meta.lotSize : raw >= 100 ? 0.01 : raw >= 1 ? 0.001 : 0.00001
    qty = Math.floor(raw / step + 1e-9) * step
  }
  const riskAmt = qty && stopDist ? qty * stopDist : null
  const rewardAmt = qty && fill != null && tp != null ? qty * Math.abs(tp - fill) : null
  const rr = stopDist && fill != null && tp != null ? Math.abs(tp - fill) / stopDist : null
  const actualRiskPct = riskAmt != null && eq > 0 ? (riskAmt / eq) * 100 : null
  const notional = qty && fill != null ? qty * fill : null
  const fees = notional != null ? (notional * commissionPct * 2) / 100 : 0

  const setTpByR = (r: number) => {
    if (fill == null || stopDist == null) return
    setTp(roundTo(fill + dir * stopDist * r, dec))
  }

  const submit = () => {
    const s = useStore.getState()
    if (!qty) return s.notify(mode === 'risk' ? 'Set a stop loss so the size can be calculated from your risk.' : 'Enter a position size.', 'bad')
    const err = s.placeOrder({ kind, dir, qty, price: kind === 'market' ? null : price, sl, tp, tag, note })
    if (err) return s.notify(err, 'bad')
    s.notify(kind === 'market' ? `${dir === 1 ? 'Long' : 'Short'} opened · ${fmtQty(qty)} @ ${fmtPrice(fill, dec)}` : `${kind === 'limit' ? 'Limit' : 'Stop'} order placed @ ${fmtPrice(price, dec)}`, 'good')
    setNote('')
  }

  const long = dir === 1
  return (
    <div className="space-y-3 p-3">
      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg p-1">
        <button className={`h-10 rounded-md text-sm font-semibold transition-colors ${long ? 'bg-up text-bg' : 'text-muted hover:text-up'}`} onClick={() => setDir(1)}>Long</button>
        <button className={`h-10 rounded-md text-sm font-semibold transition-colors ${!long ? 'bg-down text-white' : 'text-muted hover:text-down'}`} onClick={() => setDir(-1)}>Short</button>
      </div>

      <div className="seg w-full">
        {(['market', 'limit', 'stop'] as Kind[]).map((k) => (
          <button key={k} className="flex-1 capitalize" data-on={kind === k} onClick={() => { setKind(k); if (k !== 'market' && price == null) setPrice(roundTo(cur, dec)) }}>{k}</button>
        ))}
      </div>

      <div>
        <label className="label">{kind === 'market' ? 'Entry — current price' : `Entry — ${kind} price`}</label>
        {kind === 'market' ? <input className="input" disabled value={fmtPrice(cur, dec)} /> : <NumInput value={price} onChange={setPrice} />}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="label"><span className="text-down">Stop loss</span></label>
          <NumInput value={sl} onChange={setSl} placeholder="price" />
        </div>
        <div>
          <label className="label"><span className="text-up">Take profit</span></label>
          <NumInput value={tp} onChange={setTp} placeholder="optional" />
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted">Target at</span>
        {[1, 1.5, 2, 3].map((r) => (
          <button key={r} className="num h-6 rounded border border-line px-2 text-[11px] text-text hover:border-up hover:text-up disabled:hover:border-line" disabled={stopDist == null} onClick={() => setTpByR(r)}>{r}R</button>
        ))}
      </div>

      <div className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-ink">Position size</span>
          <div className="seg">
            <button data-on={mode === 'risk'} onClick={() => setMode('risk')}>By risk %</button>
            <button data-on={mode === 'size'} onClick={() => setMode('size')}>Fixed</button>
          </div>
        </div>
        {mode === 'risk' ? (
          <div className="flex items-center gap-1.5">
            <div className="relative flex-1">
              <NumInput value={riskPct} onChange={setRiskPct} className="pr-7" />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted">%</span>
            </div>
            {[0.5, 1, 2].map((r) => (
              <button key={r} className="num h-9 rounded-md border border-line px-2.5 text-xs text-text hover:bg-raised" data-on={riskPct === r} onClick={() => setRiskPct(r)}>{r}%</button>
            ))}
          </div>
        ) : (
          <NumInput value={manualQty} onChange={setManualQty} placeholder="units" />
        )}

        <dl className="mt-3 space-y-1.5 text-xs">
          <Row k="Size">
            {qty ? <>{fmtQty(qty)} <span className="text-muted">units{meta.lotSize > 1 ? ` · ${fmtQty(qty / meta.lotSize)} lot` : ''}</span></> : <span className="text-muted">{mode === 'risk' ? 'needs a stop loss' : '—'}</span>}
          </Row>
          <Row k="Risk">
            {riskAmt != null ? <span className="text-down">{fmtMoney(riskAmt, currency)} <span className="text-muted">· {actualRiskPct!.toFixed(2)}%</span></span> : <span className="text-muted">undefined</span>}
          </Row>
          <Row k="Reward">{rewardAmt != null ? <span className="text-up">{fmtMoney(rewardAmt, currency)}</span> : <span className="text-muted">—</span>}</Row>
          <Row k="Risk : reward">{rr != null ? `1 : ${rr.toFixed(2)}` : <span className="text-muted">—</span>}</Row>
          <Row k="Notional">{notional != null ? fmtMoney(notional, currency) : <span className="text-muted">—</span>}</Row>
          {fees > 0 && <Row k="Fees (round trip)">{fmtMoney(fees, currency)}</Row>}
        </dl>
      </div>

      {(actualRiskPct ?? 0) > 2.05 && <Warn>Risk is {actualRiskPct!.toFixed(1)}% of equity — above the 2% guideline.</Warn>}
      {sl == null && <Warn>No stop loss: risk is undefined and this trade cannot be scored in R.</Warn>}
      {rr != null && rr < 1 && <Warn>Target is smaller than the risk (below 1 : 1).</Warn>}

      <div className="grid grid-cols-[1fr_1.2fr] gap-2">
        <div>
          <label className="label">Strategy</label>
          <select className="input" value={tag} onChange={(e) => setTag(e.target.value)}>
            {STRATEGY_TAGS.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Why this trade?</label>
          <input className="input !font-sans" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional note" />
        </div>
      </div>

      <button
        className={`h-11 w-full rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 ${long ? 'bg-up text-bg' : 'bg-down text-white'}`}
        disabled={!replay}
        onClick={submit}
      >
        {!replay ? 'Start a replay to trade' : kind === 'market' ? `${long ? 'Buy' : 'Sell'} at market` : `Place ${long ? 'buy' : 'sell'} ${kind}`}
      </button>
      <p className="num text-center text-[11px] text-muted">
        Equity {fmtMoney(eq, currency)} · spread {fmtPrice(spread, dec)}
      </p>
    </div>
  )
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className="text-muted">{k}</dt>
    <dd className="num text-right text-ink">{children}</dd>
  </div>
)

const Warn = ({ children }: { children: React.ReactNode }) => (
  <p className="flex gap-2 rounded-md border border-amber/30 bg-amber/10 px-2.5 py-2 text-xs text-amber">
    <TriangleAlert size={14} className="mt-0.5 shrink-0" />
    <span>{children}</span>
  </p>
)
