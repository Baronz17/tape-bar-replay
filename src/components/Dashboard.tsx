import { useMemo, useState } from 'react'
import { useStore } from '../store'
import { computeStats, type Stats } from '../lib/stats'
import { fmtMoney, fmtR } from '../lib/format'
import { C } from '../lib/theme'
import { Empty } from './ui'
import { ScopePicker, useScopedTrades, type Scope } from './Journal'

/** Small responsive line/area chart. `values` are plotted evenly spaced. */
function Spark({ values, color, baseline, height, fmt }: { values: number[]; color: string; baseline: number; height: number; fmt: (v: number) => string }) {
  const [hover, setHover] = useState<number | null>(null)
  const W = 300
  const min = Math.min(...values, baseline)
  const max = Math.max(...values, baseline)
  const span = max - min || 1
  const x = (i: number) => (values.length > 1 ? (i / (values.length - 1)) * W : W / 2)
  const y = (v: number) => 4 + (1 - (v - min) / span) * (height - 8)
  const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const area = `${path}L${W},${y(baseline)}L0,${y(baseline)}Z`
  const idx = hover ?? values.length - 1
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        className="block w-full touch-none"
        style={{ height }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setHover(Math.max(0, Math.min(values.length - 1, Math.round(((e.clientX - r.left) / r.width) * (values.length - 1)))))
        }}
        onPointerLeave={() => setHover(null)}
      >
        <line x1="0" x2={W} y1={y(baseline)} y2={y(baseline)} stroke={C.line} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
        <path d={area} fill={color} opacity=".13" />
        <path d={path} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1="0" y2={height} stroke="#4a5462" vectorEffect="non-scaling-stroke" />}
      </svg>
      <div className="num pointer-events-none absolute right-0 top-0 rounded bg-panel/90 px-1.5 text-[11px] text-ink">
        {hover != null && <span className="mr-1.5 text-muted">trade {idx}</span>}
        {fmt(values[idx])}
      </div>
    </div>
  )
}

function Metric({ label, value, tone, hint }: { label: string; value: string; tone?: 'up' | 'down'; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-bg/40 px-3 py-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`num mt-0.5 text-[17px] font-medium leading-tight ${tone === 'up' ? 'text-up' : tone === 'down' ? 'text-down' : 'text-ink'}`}>{value}</div>
      {hint && <div className="num mt-0.5 text-[10.5px] text-muted">{hint}</div>}
    </div>
  )
}

export function StatsGrid({ st, currency }: { st: Stats; currency: string }) {
  const sign = (v: number) => (v > 0 ? 'up' : v < 0 ? 'down' : undefined)
  return (
    <div className="grid grid-cols-2 gap-2">
      <Metric label="Net result" value={fmtMoney(st.net, currency, true)} tone={sign(st.net)} hint={`${fmtR(st.totalR)} total`} />
      <Metric label="Win rate" value={`${st.winRate.toFixed(0)}%`} hint={`${st.wins}W · ${st.losses}L · ${st.count} trades`} />
      <Metric label="Profit factor" value={st.profitFactor === Infinity ? '∞' : st.profitFactor.toFixed(2)} tone={st.count ? (st.profitFactor >= 1 ? 'up' : 'down') : undefined} hint="gross win ÷ gross loss" />
      <Metric label="Expectancy / trade" value={fmtR(st.expectancyR)} tone={sign(st.expectancyR ?? 0)} hint={fmtMoney(st.expectancy, currency, true)} />
      <Metric label="Average win" value={fmtMoney(st.avgWin, currency)} tone={st.avgWin ? 'up' : undefined} />
      <Metric label="Average loss" value={fmtMoney(-st.avgLoss, currency)} tone={st.avgLoss ? 'down' : undefined} hint={st.avgLoss ? `win/loss ${(st.avgWin / st.avgLoss).toFixed(2)}` : undefined} />
      <Metric label="Max losing streak" value={String(st.maxConsecLosses)} hint="consecutive losses" />
      <Metric label="Max drawdown" value={`${st.maxDrawdownPct.toFixed(1)}%`} tone={st.maxDrawdownPct < 0 ? 'down' : undefined} hint="from equity peak" />
    </div>
  )
}

export function Dashboard() {
  const [scope, setScope] = useState<Scope>('all')
  const trades = useScopedTrades(scope)
  const currency = useStore((s) => s.account.currency)
  const startBalance = useStore((s) => s.account.startBalance)
  const sessionStart = useStore((s) => s.session.startBalance)
  const base = scope === 'session' ? sessionStart : startBalance
  const st = useMemo(() => computeStats(trades, base), [trades, base])

  return (
    <div className="space-y-3 p-3">
      <ScopePicker scope={scope} onChange={setScope} />
      {!st.count ? (
        <Empty title="Nothing to measure yet">Close a few replay trades and your equity curve, win rate and expectancy will build up here.</Empty>
      ) : (
        <>
          <div className="card p-3">
            <div className="mb-1 text-xs font-medium text-ink">Equity curve</div>
            <Spark values={st.equity} color={st.net >= 0 ? C.up : C.down} baseline={base} height={120} fmt={(v) => fmtMoney(v, currency)} />
            <div className="mb-1 mt-3 text-xs font-medium text-ink">Drawdown</div>
            <Spark values={st.drawdown} color={C.down} baseline={0} height={56} fmt={(v) => `${v.toFixed(1)}%`} />
          </div>
          <StatsGrid st={st} currency={currency} />
        </>
      )}
    </div>
  )
}
