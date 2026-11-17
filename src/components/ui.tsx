import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function useIsDesktop() {
  const q = '(min-width: 768px)'
  const [v, setV] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const on = () => setV(m.matches)
    on()
    m.addEventListener('change', on)
    window.addEventListener('resize', on)
    return () => {
      m.removeEventListener('change', on)
      window.removeEventListener('resize', on)
    }
  }, [])
  return v
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 md:items-center md:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`flex max-h-[92dvh] w-full flex-col rounded-t-xl border border-line bg-panel shadow-2xl md:rounded-xl ${wide ? 'md:max-w-3xl' : 'md:max-w-lg'}`}>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-line pl-4 pr-2">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          <button className="btn-ghost h-8 w-8" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  )
}

/** Anchored dropdown that closes on outside click. */
export function Popover({ button, children, align = 'left' }: { button: (open: boolean, toggle: () => void) => ReactNode; children: (close: () => void) => ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const on = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', on)
    return () => window.removeEventListener('pointerdown', on)
  }, [open])
  return (
    <div ref={ref} className="relative">
      {button(open, () => setOpen((o) => !o))}
      {open && (
        <div className={`absolute top-full z-40 mt-1.5 min-w-[220px] rounded-lg border border-line bg-panel p-2 shadow-2xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** Numeric text field that keeps the raw string while typing and reports a number (or null). */
export function NumInput({ value, onChange, placeholder, disabled, step, className = '' }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; disabled?: boolean; step?: number; className?: string }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  const last = useRef(value)
  useEffect(() => {
    if (value !== last.current) {
      last.current = value
      setText(value == null ? '' : String(value))
    }
  }, [value])
  return (
    <input
      className={`input ${className}`}
      type="number"
      inputMode="decimal"
      step={step ?? 'any'}
      placeholder={placeholder}
      disabled={disabled}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = e.target.value === '' ? null : Number(e.target.value)
        const v = n != null && isFinite(n) ? n : null
        last.current = v
        onChange(v)
      }}
    />
  )
}

export function Toggle({ on, onChange, label, hint, swatch }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string; swatch?: string }) {
  return (
    <button className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-raised" onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      {swatch && <span className="h-0.5 w-4 shrink-0 rounded" style={{ background: swatch }} />}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-ink">{label}</span>
        {hint && <span className="block text-[11px] text-muted">{hint}</span>}
      </span>
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${on ? 'bg-amber' : 'bg-line'}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-bg transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
    </button>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="text-[13px] font-medium text-text">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-[260px] text-xs text-muted">{children}</p>}
    </div>
  )
}
