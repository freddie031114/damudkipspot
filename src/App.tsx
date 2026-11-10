import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { auth, db, firebaseReady, missingFirebaseConfig } from './lib/firebase'
import { firestoreSource } from './data/firestoreSource'
import { demoSource } from './data/demoSeed'
import { StoreProvider, useStore } from './data/store'
import type { DataSource } from './data/source'
import type { InventoryRow } from './data/derive'
import { Inventory, type View } from './ui/Inventory'
import { QuickAdd } from './ui/QuickAdd'
import { QuickSell } from './ui/QuickSell'
import { CheatSheet } from './ui/CheatSheet'
import { isTyping } from './ui/common'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile } from './lib/profile'

const card = 'mx-auto mt-24 max-w-md rounded-lg border border-slate-300 p-6 dark:border-slate-700'
const input = 'w-full rounded border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600'
const button = 'rounded bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50'
const btnCls = 'rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50'
const ghostBtn = 'rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100 disabled:opacity-40 dark:border-slate-600 dark:hover:bg-slate-800'

function SetupNeeded() {
  return (
    <main className={card}>
      <h1 className="mb-2 text-xl font-semibold">Firebase is not configured</h1>
      <p className="mb-2 text-sm">Add these to <code>.env.local</code> (and to the Vercel project's environment variables):</p>
      <ul className="list-disc pl-5 text-sm">
        {missingFirebaseConfig.map((k) => (
          <li key={k}><code>VITE_FIREBASE_{k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}</code></li>
        ))}
      </ul>
    </main>
  )
}

function Login() {
  const [email, setEmail] = useState('damudkipspot@gmail.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signInWithEmailAndPassword(auth!, email, password)
    } catch {
      setError('Sign in failed. Check the password, and that you are online the first time.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className={card}>
      <h1 className="mb-4 text-xl font-semibold">Card Stock</h1>
      <label className="mb-3 block text-sm">Email
        <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </label>
      <label className="mb-4 block text-sm">Password
        <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
      </label>
      {error && <p role="alert" className="mb-3 text-sm text-red-500">{error}</p>}
      <button className={button} disabled={busy}>Sign in</button>
    </form>
  )
}

function WhoIsThis() {
  const { setActing } = useActingProfile()
  return (
    <main className={card}>
      <h1 className="mb-4 text-xl font-semibold">Who's using this laptop?</h1>
      <div className="flex gap-3">
        {PROFILE_IDS.map((p) => (
          <button key={p} className={button} onClick={() => setActing(p)}>{DEFAULT_NAMES[p]}</button>
        ))}
      </div>
    </main>
  )
}

function StatusPill() {
  const { online, pending } = useStore()
  const text = !online ? (pending ? 'Offline: changes saved on this laptop, will sync' : 'Offline') : pending ? 'Syncing…' : 'All changes synced'
  const tone = !online ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : pending ? 'bg-sky-500/20' : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
  return <span role="status" className={`rounded-full px-3 py-0.5 text-xs ${tone}`}>{text}</span>
}

function Toasts() {
  const { toast, dismissToast } = useStore()
  if (!toast) return null
  return (
    <div role="status" aria-live="polite" className={`fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-2 shadow-lg ${toast.error ? 'bg-red-600 text-white' : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'}`}>
      <span>{toast.text}</span>
      {toast.undo && <button className="font-semibold underline" onClick={() => { toast.undo!(); dismissToast() }}>Undo</button>}
      <button aria-label="Dismiss" onClick={dismissToast}>×</button>
    </div>
  )
}

function Shell({ email, onSignOut }: { email: string; onSignOut?: () => void }) {
  const { acting, setActing } = useActingProfile()
  const { undo, canUndo, pending, rows } = useStore()
  const [view, setView] = useState<View>(acting ?? 'p1')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<null | { kind: 'add' } | { kind: 'sell'; row?: InventoryRow } | { kind: 'keys' }>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isTyping(e.target)) { e.preventDefault(); undo(); return }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || modal) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
      else if (e.key === 'n') { e.preventDefault(); setModal({ kind: 'add' }) }
      else if (e.key === 's') { e.preventDefault(); setModal({ kind: 'sell' }) }
      else if (e.key === '?') { setModal({ kind: 'keys' }) }
      else if (e.key === '1') setView('p1')
      else if (e.key === '2') setView('p2')
      else if (e.key === '3') setView('all')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, modal])

  // Warn before closing the tab while changes are still waiting to sync.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending) e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending])

  const tab = (v: View, label: string, key: string) => (
    <button key={v} aria-pressed={view === v} onClick={() => setView(v)}
      className={`rounded px-3 py-1 text-sm ${view === v ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
      {label} <span className="text-xs opacity-60">{key}</span>
    </button>
  )
  const owner = view === 'all' ? (acting ?? 'p1') : view

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-slate-300 px-4 py-2 dark:border-slate-700">
        <strong>Card Stock</strong>
        <nav className="flex gap-1" aria-label="Inventory view">
          {tab('p1', DEFAULT_NAMES.p1, '1')}{tab('p2', DEFAULT_NAMES.p2, '2')}{tab('all', 'Combined', '3')}
        </nav>
        <input ref={searchRef} aria-label="Search inventory" placeholder="Search  ( / )" value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur() } }}
          className="min-w-0 max-w-md flex-1 rounded border border-slate-300 bg-transparent px-3 py-1.5 dark:border-slate-600" />
        <button className={btnCls} onClick={() => setModal({ kind: 'add' })}>Add (N)</button>
        <button className={btnCls} onClick={() => setModal({ kind: 'sell' })}>Sell (S)</button>
        <button className={ghostBtn} onClick={undo} disabled={!canUndo}>Undo</button>
        <span className="ml-auto flex items-center gap-3">
          <StatusPill />
          <label className="text-sm">Using as{' '}
            <select aria-label="Acting profile" className="rounded border border-slate-300 bg-transparent px-1 py-0.5 dark:border-slate-600" value={acting ?? ''} onChange={(e) => setActing(e.target.value as 'p1' | 'p2')}>
              {PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}
            </select>
          </label>
          <button className="text-sm underline" onClick={() => setModal({ kind: 'keys' })} aria-label="Keyboard shortcuts">?</button>
          {onSignOut && <button className="text-sm underline" title={email} onClick={() => { if (!pending || confirm('Some changes have not synced yet. Signing out now may lose them. Sign out anyway?')) onSignOut() }}>Sign out</button>}
        </span>
      </header>
      <Inventory view={view} search={search} selected={selected} setSelected={setSelected} onSell={(r) => setModal({ kind: 'sell', row: r })} />
      <span className="sr-only">{rows.length} items loaded</span>
      {modal?.kind === 'add' && <QuickAdd owner={owner} onClose={() => setModal(null)} />}
      {modal?.kind === 'sell' && <QuickSell initial={modal.row} onClose={() => setModal(null)} />}
      {modal?.kind === 'keys' && <CheatSheet onClose={() => setModal(null)} />}
      <Toasts />
    </div>
  )
}

const DEMO = import.meta.env.DEV && new URLSearchParams(location.search).has('demo')

export function App() {
  const { acting } = useActingProfile()
  const [user, setUser] = useState<User | null | undefined>(undefined)
  useEffect(() => (auth ? onAuthStateChanged(auth, setUser) : undefined), [])
  const source = useMemo<DataSource | null>(() => (DEMO ? demoSource() : db && user ? firestoreSource(db) : null), [user])

  if (DEMO) {
    if (!acting) return <WhoIsThis />
    return <StoreProvider source={source!}><Shell email="demo" /></StoreProvider>
  }
  if (!firebaseReady) return <SetupNeeded />
  if (user === undefined) return <p className="p-6">Loading…</p>
  if (!user) return <Login />
  if (!acting) return <WhoIsThis />
  return (
    <StoreProvider source={source!}>
      <Shell email={user.email ?? ''} onSignOut={() => void signOut(auth!)} />
    </StoreProvider>
  )
}
