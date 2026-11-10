import { useEffect, useRef, type ReactNode } from 'react'

export const inputCls = 'w-full rounded-2xl border border-line bg-surface shadow-card px-2.5 py-1.5 transition-colors hover:border-brand/50 focus:border-brand'
export const btnCls = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-sm font-medium text-brand-fg shadow-sm transition-colors hover:bg-brand-hover disabled:opacity-50'
export const accentBtn = 'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-[#2b1600] shadow-sm transition-colors hover:brightness-95 disabled:opacity-50'
export const ghostBtn = 'inline-flex items-center justify-center gap-1.5 rounded-2xl border border-line bg-surface shadow-card px-3 py-1.5 text-sm transition-colors hover:bg-hover disabled:opacity-40'

export function Modal({ title, onClose, children, wide, xl }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; xl?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-[#06131f]/55 p-4 pt-[6vh] backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-label={title} className={`w-full ${xl ? 'max-w-6xl' : wide ? 'max-w-2xl' : 'max-w-md'} rounded-2xl border border-line bg-surface p-5 shadow-pop`}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button aria-label="Close" className="px-2 text-xl leading-none" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}
