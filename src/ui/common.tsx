import { useEffect, useRef, type ReactNode } from 'react'

export const inputCls = 'w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 dark:border-slate-600'
export const btnCls = 'rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50'
export const ghostBtn = 'rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800'

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 p-4 pt-[10vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-label={title} className={`w-full ${wide ? 'max-w-2xl' : 'max-w-md'} rounded-lg bg-white p-5 shadow-xl dark:bg-slate-900`}>
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
