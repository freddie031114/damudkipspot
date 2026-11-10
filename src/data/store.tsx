import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useActingProfile } from '../lib/profile'
import type { Change, Ctx } from './changes'
import { buildInventory, settingsFor, type InventoryRow, type RawData } from './derive'
import type { DataSource } from './source'

interface UndoEntry {
  label: string
  inverse: NonNullable<Change['inverse']>
}

interface Toast {
  id: number
  text: string
  undo?: () => void
  error?: boolean
}

interface AppStore {
  ready: boolean
  raw: RawData
  source: DataSource
  rows: InventoryRow[]
  pending: boolean
  online: boolean
  toast: Toast | null
  /** Commit a change (data + audit). Returns immediately, even offline. */
  apply: (change: Change | null, opts?: { undoable?: boolean }) => void
  undo: () => void
  canUndo: boolean
  dismissToast: () => void
  notify: (text: string, error?: boolean) => void
}

const Ctx = createContext<AppStore | null>(null)
const empty: RawData = { items: [], lots: [], sales: [], adjustments: [], shows: [], showExpenses: [], profiles: [] }

export function StoreProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  const { acting } = useActingProfile()
  const [raw, setRaw] = useState<RawData>(empty)
  const [ready, setReady] = useState(false)
  const [pending, setPending] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [toast, setToast] = useState<Toast | null>(null)
  const [undoDepth, setUndoDepth] = useState(0)
  const stack = useRef<UndoEntry[]>([])
  const toastId = useRef(0)
  const timer = useRef<number | undefined>(undefined)

  const notify = useCallback((text: string, error = false, undo?: () => void) => {
    window.clearTimeout(timer.current)
    setToast({ id: ++toastId.current, text, error, undo })
    timer.current = window.setTimeout(() => setToast(null), error ? 8000 : 6000)
  }, [])

  useEffect(() => {
    return source.subscribe(
      (d, meta) => { setRaw(d); setPending(meta.pending); setReady(true) },
      (e) => notify(`Could not load data: ${e.message}`, true),
    )
  }, [source, notify])

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const mkCtx = useCallback((): Ctx => {
    if (!acting) throw new Error('Choose who is using the app first')
    return { actor: acting, now: Date.now(), newId: () => crypto.randomUUID() }
  }, [acting])

  const run = useCallback((ops: Change['ops'], label: string) => {
    source.commit(ops).catch((e: Error) => notify(`Not saved: ${label}. ${e.message}`, true))
  }, [source, notify])

  const undo = useCallback(() => {
    const entry = stack.current.pop()
    setUndoDepth(stack.current.length)
    if (!entry) return
    try {
      run(entry.inverse(mkCtx()), `undo ${entry.label}`)
      notify(`Undid: ${entry.label}`)
    } catch (e) {
      notify((e as Error).message, true)
    }
  }, [run, mkCtx, notify])

  const apply = useCallback((change: Change | null, opts: { undoable?: boolean } = {}) => {
    if (!change) return
    run(change.ops, change.label)
    const inverse = change.inverse
    if (inverse && opts.undoable !== false) {
      stack.current.push({ label: change.label, inverse })
      if (stack.current.length > 50) stack.current.shift()
      setUndoDepth(stack.current.length)
      notify(change.label, false, undo)
    } else {
      notify(change.label)
    }
  }, [run, notify, undo])

  const rows = useMemo(() => buildInventory(raw, (p) => settingsFor(raw.profiles, p)), [raw])

  const value: AppStore = {
    ready, raw, source, rows, pending, online, toast, apply, undo,
    canUndo: undoDepth > 0,
    dismissToast: () => setToast(null),
    notify: (t, e) => notify(t, e),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore(): AppStore {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore outside StoreProvider')
  return v
}

/** Context factory for UI code that builds changes (needs the acting profile). */
export function useChangeCtx(): () => Ctx {
  const { acting } = useActingProfile()
  return useCallback(() => {
    if (!acting) throw new Error('Choose who is using the app first')
    return { actor: acting, now: Date.now(), newId: () => crypto.randomUUID() }
  }, [acting])
}
