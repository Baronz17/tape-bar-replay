import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, CircleCheck, CircleX, Dices, Eye, EyeOff, Flame, Lightbulb, Plus, Rows3, ShieldCheck, Trash2, TrendingUp, X, Zap } from 'lucide-react'
import { useStore } from '../../store'
import { BUILT_IN, allDrills, buildCustomDrill, categoryStats, customSource, dailyDrill, nextDrill, useDrills } from '../../drills/store'
import { CATEGORIES, type Difficulty, type DrillAnswer, type DrillCategory, type DrillGrade, type DrillScenario } from '../../drills/types'
import { grade } from '../../drills/grade'
import { fmtPrice } from '../../lib/format'
import { Modal } from '../ui'
import { DrillChart } from './DrillChart'

const CAT_META: Record<DrillCategory, { icon: typeof Rows3; blurb: string }> = {
  'S&R Mapping': { icon: Rows3, blurb: 'Find the levels price actually respects.' },
  'Breakout vs Fakeout': { icon: Zap, blurb: 'Tell commitment from a stop hunt.' },
  'SL & Risk-Reward': { icon: ShieldCheck, blurb: 'Put the stop where the idea is wrong.' },
  'Market Structure': { icon: TrendingUp, blurb: 'Read highs and lows before you pick a side.' },
}
const DIFF_TONE: Record<Difficulty, string> = { Beginner: 'bg-up/15 text-up', Intermediate: 'bg-amber/15 text-amber', Pro: 'bg-down/15 text-down' }
const REVEAL_MS = 800 / 3 // 3x replay speed

export function DrillsView() {
  const loaded = useDrills((s) => s.loaded)
  const [active, setActive] = useState<DrillScenario | null>(null)
  const [run, setRun] = useState(0) // bumps to remount the drill on Retry
  useEffect(() => {
    void useDrills.getState().load()
  }, [])
  if (!loaded) return <div className="grid h-dvh place-items-center text-xs text-muted">Loading drills…</div>
  if (active)
    return (
      <ActiveDrill
        key={active.id + run}
        scenario={active}
        onExit={() => setActive(null)}
        onRetry={() => setRun((r) => r + 1)}
        onNext={() => { setActive(nextDrill(active)); setRun(0) }}
      />
    )
  return <Hub onStart={setActive} />
}

// ───────────────────────── hub ─────────────────────────

function BlindToggle({ compact }: { compact?: boolean }) {
  const blind = useDrills((s) => s.blind)
  return (
    <button
      className={`btn-ghost h-8 gap-1.5 px-2 text-xs ${compact ? 'w-8 !px-0' : ''}`}
      data-on={blind}
      title="Blind mode hides the symbol and all dates, so only price action is left"
      aria-pressed={blind}
      onClick={() => useDrills.getState().setBlind(!blind)}
    >
      {blind ? <EyeOff size={15} /> : <Eye size={15} />}
      {!compact && <span>Blind mode {blind ? 'on' : 'off'}</span>}
    </button>
  )
}

function Hub({ onStart }: { onStart: (s: DrillScenario) => void }) {
  const state = useDrills()
  const [saving, setSaving] = useState(false)
  const list = allDrills(state)
  const passed = list.filter((d) => state.results[d.id]?.passed).length
  const daily = useMemo(dailyDrill, [])
  const dailyDone = state.results[daily.id]?.passed

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-panel px-2">
        <button className="btn-ghost h-8 gap-1.5 px-2 text-xs" onClick={() => useStore.setState({ view: 'replay' })}><ArrowLeft size={15} /> Replay</button>
        <span className="h-5 w-px bg-line" />
        <h1 className="text-[13px] font-semibold text-ink">Guided drills</h1>
        <div className="flex-1" />
        <BlindToggle />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 p-3 md:p-6">
          <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
            <button className="card group flex items-center gap-4 border-amber/40 bg-amber/[0.07] p-4 text-left transition-colors hover:bg-amber/[0.12]" onClick={() => onStart(daily)}>
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-amber text-bg"><Dices size={22} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-medium uppercase tracking-wider text-amber">Random daily drill</span>
                <span className="block text-[15px] font-semibold text-ink">{dailyDone ? 'Done for today — run it again' : 'Start today\'s drill'}</span>
                <span className="block truncate text-xs text-muted">{daily.category} · {daily.difficulty} · one new pick every day</span>
              </span>
              {dailyDone && <CircleCheck size={20} className="shrink-0 text-up" />}
            </button>
            <div className="card grid grid-cols-3 divide-x divide-line">
              <Stat label="Passed" value={`${passed}/${list.length}`} />
              <Stat label="Streak" value={String(state.streak)} icon={state.streak > 1} />
              <Stat label="Best streak" value={String(state.bestStreak)} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {CATEGORIES.map((cat) => {
              const st = categoryStats(cat, state)
              const Icon = CAT_META[cat].icon
              const pct = st.total ? (st.done / st.total) * 100 : 0
              return (
                <section key={cat} className="card overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-raised text-text"><Icon size={18} /></span>
                      <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-semibold text-ink">{cat}</h2>
                        <p className="text-xs text-muted">{CAT_META[cat].blurb}</p>
                      </div>
                      <div className="text-right">
                        <div className="num text-sm font-medium text-ink">{st.accuracy == null ? '—' : `${st.accuracy.toFixed(0)}%`}</div>
                        <div className="text-[10.5px] text-muted">avg accuracy</div>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2.5">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={st.done} aria-valuemin={0} aria-valuemax={st.total} aria-label={`${cat} completion`}>
                        <div className="h-full rounded-full bg-up transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="num text-[11px] text-muted">{st.done}/{st.total} passed</span>
                    </div>
                  </div>
                  <ul className="border-t border-line">
                    {list.filter((d) => d.category === cat).map((d) => {
                      const r = state.results[d.id]
                      return (
                        <li key={d.id} className="flex items-center border-b border-line/60 last:border-0">
                          <button className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-2.5 text-left hover:bg-raised" onClick={() => onStart(d)}>
                            <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${r?.passed ? 'border-up bg-up text-bg' : 'border-line text-transparent'}`}><Check size={12} strokeWidth={3} /></span>
                            <span className="min-w-0 flex-1 truncate text-[13px] text-text">{d.title}</span>
                            {d.custom && <span className="chip bg-blue/15 text-blue">MINE</span>}
                            <span className={`chip ${DIFF_TONE[d.difficulty]}`}>{d.difficulty.toUpperCase()}</span>
                            <span className="num w-9 text-right text-[11px] text-muted">{r ? `${r.best}%` : 'new'}</span>
                          </button>
                          {d.custom && (
                            <button className="btn-ghost mr-2 h-8 w-8 text-down" title="Delete this custom drill" onClick={() => window.confirm(`Delete "${d.title}"?`) && state.removeCustom(d.id)}><Trash2 size={14} /></button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>

          <div className="card flex flex-col gap-3 p-4 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-ink">Make your own drill</h2>
              <p className="text-xs text-muted">Freeze the current replay position into a drill. Select a horizontal line or a long/short tool on the chart first to make it the answer — otherwise it becomes a "what happens next" question graded on the real outcome.</p>
            </div>
            <button className="btn shrink-0" onClick={() => setSaving(true)}><Plus size={15} /> Save drill from replay</button>
          </div>

          <p className="pb-4 text-[11px] leading-relaxed text-muted">
            The {BUILT_IN.length} built-in drills are constructed teaching patterns, not real market history: each one is scripted so the textbook answer holds and the reveal shows why.
            {passed > 0 && <> <button className="underline hover:text-ink" onClick={() => window.confirm('Clear all drill scores and streaks?') && state.resetProgress()}>Reset progress</button></>}
          </p>
        </div>
      </div>
      {saving && <SaveDrill onClose={() => setSaving(false)} />}
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <div className="px-3 py-3 text-center">
      <div className="num flex items-center justify-center gap-1 text-xl font-medium text-ink">{icon && <Flame size={16} className="text-amber" />}{value}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </div>
  )
}

function SaveDrill({ onClose }: { onClose: () => void }) {
  const src = useMemo(customSource, [])
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<DrillCategory>(src.kind === 'level' ? 'S&R Mapping' : src.kind === 'rr' ? 'SL & Risk-Reward' : 'Market Structure')
  const [difficulty, setDifficulty] = useState<Difficulty>('Intermediate')
  const [why, setWhy] = useState('')
  const [error, setError] = useState('')
  const kindText = {
    level: 'Answer: the selected horizontal line. The drill will ask to mark that level.',
    rr: 'Answer: the selected long/short tool. The drill will ask for a trade plan with the stop beyond yours.',
    direction: 'No line or position tool is selected, so this becomes a "where does price go next?" question, graded on what the data actually did.',
  }[src.kind]
  const save = () => {
    const res = buildCustomDrill({ title, category, difficulty, explanationText: why })
    if (typeof res === 'string') return setError(res)
    useDrills.getState().addCustom(res)
    useStore.getState().notify(`Drill "${res.title}" saved.`, 'good')
    onClose()
  }
  return (
    <Modal title="Save drill from replay" onClose={onClose}>
      <p className="mb-3 rounded-md border border-line bg-bg/50 px-3 py-2 text-xs text-text">{kindText}</p>
      <div className="space-y-3">
        <div>
          <label className="label">Title</label>
          <input className="input !font-sans" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Failed retest of the daily high" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Category</label>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value as DrillCategory)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </div>
          <div>
            <label className="label">Difficulty</label>
            <select className="input" value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>{(['Beginner', 'Intermediate', 'Pro'] as const).map((c) => <option key={c}>{c}</option>)}</select>
          </div>
        </div>
        <div>
          <label className="label">Explanation shown after the reveal (optional)</label>
          <textarea className="input" rows={3} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="What should future-you notice here?" />
        </div>
        {error && <p className="rounded-md border border-down/40 bg-down/10 px-3 py-2 text-xs text-down">{error}</p>}
        <p className="text-[11px] text-muted">The question uses the candles revealed so far on the current timeframe; the next 24 candles of the dataset become the reveal.</p>
        <button className="btn w-full border-amber/50 bg-amber/15 text-amber" onClick={save}>Save drill</button>
      </div>
    </Modal>
  )
}

// ───────────────────────── active drill ─────────────────────────

function ActiveDrill({ scenario: sc, onExit, onRetry, onNext }: { scenario: DrillScenario; onExit: () => void; onRetry: () => void; onNext: () => void }) {
  const blind = useDrills((s) => s.blind)
  const [phase, setPhase] = useState<'answer' | 'reveal' | 'feedback'>('answer')
  const [visible, setVisible] = useState(sc.cutIndex)
  const [answer, setAnswer] = useState<DrillAnswer>({})
  const [rrDir, setRrDir] = useState<1 | -1>(1)
  const [hint, setHint] = useState(false)
  const [result, setResult] = useState<DrillGrade | null>(null)
  const end = sc.cutIndex + sc.revealCount
  const list = allDrills().filter((d) => d.category === sc.category)
  const position = list.findIndex((d) => d.id === sc.id) + 1

  // auto-play the reveal, then grade
  useEffect(() => {
    if (phase !== 'reveal') return
    if (visible >= end) {
      const g = grade(sc, answer)
      useDrills.getState().record(sc.id, g)
      setResult(g)
      setPhase('feedback')
      return
    }
    const t = setTimeout(() => setVisible((v) => v + 1), REVEAL_MS)
    return () => clearTimeout(t)
  }, [phase, visible, end, sc, answer])

  const ready = sc.interactionType === 'multiple_choice' ? !!answer.choiceId : sc.interactionType === 'draw_horizontal_level' ? answer.level != null : !!answer.rr
  const locked = phase !== 'answer'
  const flip = (dir: 1 | -1) => {
    setRrDir(dir)
    const rr = answer.rr
    // mirror an existing plan around its entry instead of making the user redraw it
    if (rr && rr.dir !== dir) setAnswer({ rr: { dir, entry: rr.entry, sl: 2 * rr.entry - rr.sl, tp: 2 * rr.entry - rr.tp } })
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="shrink-0 border-b border-line bg-panel">
        <div className="flex h-12 items-center gap-2 px-2">
          <button className="btn-ghost h-8 w-8" onClick={onExit} aria-label="Back to all drills"><ArrowLeft size={16} /></button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-ink">{sc.title}</div>
            <div className="truncate text-[11px] text-muted">
              {sc.category} · {position}/{list.length} · {blind ? 'symbol hidden' : `${sc.symbol} ${sc.timeframe}`}
            </div>
          </div>
          <span className={`chip ${DIFF_TONE[sc.difficulty]}`}>{sc.difficulty.toUpperCase()}</span>
          <BlindToggle compact />
        </div>
        <div className="h-0.5 bg-line" role="progressbar" aria-label="Drill progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase === 'answer' ? 0 : Math.round(((visible - sc.cutIndex) / sc.revealCount) * 100)}>
          <div className="h-full bg-amber transition-all" style={{ width: `${phase === 'answer' ? 0 : ((visible - sc.cutIndex) / sc.revealCount) * 100}%` }} />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <div className={`relative min-h-0 md:h-auto md:w-[70%] md:flex-none ${phase === 'feedback' ? 'h-[42%]' : 'h-[65%]'} shrink-0 transition-[height]`}>
          <DrillChart scenario={sc} visible={visible} blind={blind} locked={locked} answer={answer} onAnswer={setAnswer} rrDir={rrDir} showSolution={phase === 'feedback'} />
          {/* the only tool this drill needs */}
          {phase === 'answer' && sc.interactionType !== 'multiple_choice' && (
            <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-line bg-panel/90 px-2.5 py-1.5 text-[11px] text-muted">
              {sc.interactionType === 'draw_horizontal_level'
                ? answer.level == null ? 'Tool: horizontal level — tap the chart to place it' : 'Drag the line, or tap elsewhere to move it'
                : !answer.rr ? `Tool: ${rrDir === 1 ? 'long' : 'short'} position — tap near the current price` : 'Drag the red, grey and green lines to adjust'}
            </div>
          )}
          {phase === 'reveal' && (
            <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-amber/40 bg-panel/90 px-2.5 py-1.5 text-[11px] text-amber">Answer locked — revealing at 3x</div>
          )}
        </div>

        <aside className="flex min-h-0 flex-1 flex-col border-t border-line bg-panel md:border-l md:border-t-0">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {phase === 'feedback' && result ? (
              <Feedback sc={sc} g={result} />
            ) : (
              <>
                <div className="hidden text-[11px] font-medium uppercase tracking-wider text-muted md:block">Mission</div>
                <p className="text-[15px] font-medium leading-snug text-ink md:mt-1">{sc.promptText}</p>
                <ol className="mt-3 hidden space-y-1.5 md:block">
                  {sc.steps.map((s, i) => (
                    <li key={i} className="flex gap-2.5 text-xs text-text">
                      <span className="num grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-raised text-[10px] text-muted">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>

                <div className="mt-4">
                  {sc.interactionType === 'multiple_choice' && (
                    <div className="space-y-2">
                      {sc.choices?.map((c) => (
                        <button
                          key={c.id}
                          disabled={locked}
                          className={`flex min-h-12 w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left text-[13px] font-medium transition-colors ${answer.choiceId === c.id ? 'border-amber bg-amber/10 text-ink' : 'border-line text-text hover:bg-raised'}`}
                          onClick={() => setAnswer({ choiceId: c.id })}
                        >
                          <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${answer.choiceId === c.id ? 'border-amber bg-amber' : 'border-muted'}`} />
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {sc.interactionType === 'draw_horizontal_level' && (
                    <div className="flex items-center gap-3 rounded-lg border border-line bg-bg/50 px-3.5 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] text-muted">Your level</div>
                        <div className="num text-base text-ink">{answer.level != null ? fmtPrice(answer.level, sc.decimals) : 'not placed yet'}</div>
                      </div>
                      {answer.level != null && !locked && <button className="btn h-9" onClick={() => setAnswer({})}><X size={14} /> Clear</button>}
                    </div>
                  )}

                  {sc.interactionType === 'place_rr_tool' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-bg p-1">
                        <button disabled={locked} className={`h-11 rounded-md text-sm font-semibold ${rrDir === 1 ? 'bg-up text-bg' : 'text-muted'}`} onClick={() => flip(1)}>Long</button>
                        <button disabled={locked} className={`h-11 rounded-md text-sm font-semibold ${rrDir === -1 ? 'bg-down text-white' : 'text-muted'}`} onClick={() => flip(-1)}>Short</button>
                      </div>
                      {answer.rr ? (
                        <div className="num grid grid-cols-4 gap-2 rounded-lg border border-line bg-bg/50 px-3 py-2.5 text-xs">
                          <Cell k="Entry" v={fmtPrice(answer.rr.entry, sc.decimals)} />
                          <Cell k="Stop" v={fmtPrice(answer.rr.sl, sc.decimals)} tone="text-down" />
                          <Cell k="Target" v={fmtPrice(answer.rr.tp, sc.decimals)} tone="text-up" />
                          <Cell k="R:R" v={`1 : ${(Math.abs(answer.rr.tp - answer.rr.entry) / Math.max(1e-12, Math.abs(answer.rr.entry - answer.rr.sl))).toFixed(2)}`} />
                        </div>
                      ) : (
                        <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-muted">Tap the chart near the current price to drop the position tool.</p>
                      )}
                      {answer.rr && !locked && <button className="btn h-8 w-full text-xs" onClick={() => setAnswer({})}>Remove and place again</button>}
                    </div>
                  )}
                </div>

                <button className="mt-3 flex items-center gap-1.5 text-xs text-muted hover:text-amber" aria-expanded={hint} onClick={() => setHint(!hint)}>
                  <Lightbulb size={14} /> {hint ? 'Hide hint' : 'Show a hint'}
                </button>
                {hint && <p className="mt-1.5 rounded-md border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-text">{sc.hint}</p>}
              </>
            )}
          </div>

          <div className="shrink-0 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {phase === 'feedback' ? (
              <div className="grid grid-cols-2 gap-2">
                <button className="btn h-11" onClick={onRetry}>Retry</button>
                <button className="btn h-11 border-amber/50 bg-amber/15 text-amber" onClick={onNext}>Next drill</button>
              </div>
            ) : (
              <button
                className="h-11 w-full rounded-lg bg-amber text-sm font-semibold text-bg transition-opacity hover:opacity-90"
                disabled={!ready || locked}
                onClick={() => setPhase('reveal')}
              >
                {phase === 'reveal' ? `Revealing… ${visible - sc.cutIndex}/${sc.revealCount}` : ready ? 'Submit & reveal' : sc.interactionType === 'multiple_choice' ? 'Choose an answer' : 'Place your answer on the chart'}
              </button>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

const Cell = ({ k, v, tone = 'text-ink' }: { k: string; v: string; tone?: string }) => (
  <div className="min-w-0">
    <div className="font-sans text-[10.5px] text-muted">{k}</div>
    <div className={`truncate ${tone}`}>{v}</div>
  </div>
)

function Feedback({ sc, g }: { sc: DrillScenario; g: DrillGrade }) {
  const streak = useDrills((s) => s.streak)
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className={`flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold ${g.passed ? 'bg-up text-bg' : 'bg-down text-white'}`}>
          {g.passed ? <CircleCheck size={16} /> : <CircleX size={16} />} {g.passed ? 'Pass' : 'Fail'}
        </span>
        <div>
          <div className="num text-xl font-medium leading-none text-ink">{g.score}<span className="text-sm text-muted">/100</span></div>
          <div className="text-[11px] text-muted">{g.passed && streak > 1 ? `${streak} passes in a row` : 'accuracy · 70 to pass'}</div>
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {g.lines.map((l) => (
          <li key={l.label} className="flex gap-2.5">
            {l.ok ? <CircleCheck size={15} className="mt-0.5 shrink-0 text-up" /> : <CircleX size={15} className={`mt-0.5 shrink-0 ${l.scored ? 'text-down' : 'text-muted'}`} />}
            <div className="min-w-0">
              <div className="text-xs font-medium text-ink">{l.label}{!l.scored && <span className="ml-1.5 font-normal text-muted">· not scored</span>}</div>
              <div className="text-xs text-text">{l.detail}</div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-lg border border-line bg-bg/50 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted">Why</div>
        <p className="mt-1 text-[13px] leading-relaxed text-text">{sc.solution.explanationText}</p>
      </div>
      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm bg-amber/60" /> solution</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-3 bg-blue" /> your answer</span>
      </p>
    </div>
  )
}
