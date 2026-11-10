import { useEffect, useMemo, useRef, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
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
import { ImportWizard } from './ui/ImportWizard'
import { isTyping } from './ui/common'
import { Logo, Wordmark } from './ui/Logo'
import { toggleTheme } from './lib/theme'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile } from './lib/profile'

const card = 'mx-auto mt-24 max-w-md rounded-lg border border-line p-6'
const button = 'rounded bg-brand px-4 py-2 font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50'
const btnCls = 'rounded bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg hover:bg-brand-hover disabled:opacity-50'
const ghostBtn = 'rounded border border-line px-3 py-1.5 text-sm hover:bg-hover disabled:opacity-40'

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
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function google() {
    setBusy(true)
    setError('')
    try {
      await signInWithPopup(auth!, new GoogleAuthProvider())
    } catch (e) {
      const code = (e as { code?: string }).code ?? ''
      setError(
        code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' ? '' :
        code === 'auth/popup-blocked' ? 'Your browser blocked the sign-in popup. Allow popups for this site and try again.' :
        code === 'auth/unauthorized-domain' ? 'This web address is not authorised for sign-in in Firebase.' :
        code === 'auth/network-request-failed' ? 'No connection. You need to be online the first time you sign in.' :
        'Sign in failed. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={card}>
      <div className="mb-4 flex justify-center"><Logo size={64} /></div>
      <h1 className="mb-4 text-center text-2xl font-bold">da<span className="text-brand">mudkip</span>spot</h1>
      {error && <p role="alert" className="mb-3 text-sm text-red-500">{error}</p>}
      <button className={button} disabled={busy} onClick={() => void google()}>Sign in with Google</button>
      <p className="mt-3 text-xs opacity-70">Only approved Google accounts can see the stock.</p>
    </main>
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
  const tone = !online ? 'bg-accent/20 text-accent-ink' : pending ? 'bg-brand/20' : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
  return <span role="status" className={`rounded-full px-3 py-0.5 text-xs ${tone}`}>{text}</span>
}

function Toasts() {
  const { toast, dismissToast } = useStore()
  if (!toast) return null
  return (
    <div role="status" aria-live="polite" className={`fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-2 shadow-lg ${toast.error ? 'bg-red-600 text-white' : 'bg-ink text-page'}`}>
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
  const [modal, setModal] = useState<null | { kind: 'add' } | { kind: 'sell'; row?: InventoryRow } | { kind: 'keys' } | { kind: 'import' }>(null)
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
      className={`rounded px-3 py-1 text-sm ${view === v ? 'bg-brand text-brand-fg' : 'hover:bg-hover'}`}>
      {label} <span className="text-xs opacity-60">{key}</span>
    </button>
  )
  const owner = view === 'all' ? (acting ?? 'p1') : view

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2">
        <Wordmark />
        <nav className="flex gap-1" aria-label="Inventory view">
          {tab('p1', DEFAULT_NAMES.p1, '1')}{tab('p2', DEFAULT_NAMES.p2, '2')}{tab('all', 'Combined', '3')}
        </nav>
        <input ref={searchRef} aria-label="Search inventory" placeholder="Search  ( / )" value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur() } }}
          className="min-w-0 max-w-md flex-1 rounded border border-line bg-transparent px-3 py-1.5" />
        <button className={btnCls} onClick={() => setModal({ kind: 'add' })}>Add (N)</button>
        <button className={btnCls} onClick={() => setModal({ kind: 'sell' })}>Sell (S)</button>
        <button className={ghostBtn} onClick={() => setModal({ kind: 'import' })}>Import</button>
        <button className={ghostBtn} onClick={undo} disabled={!canUndo}>Undo</button>
        <span className="ml-auto flex items-center gap-3">
          <StatusPill />
          <label className="text-sm">Using as{' '}
            <select aria-label="Acting profile" className="rounded border border-line bg-transparent px-1 py-0.5" value={acting ?? ''} onChange={(e) => setActing(e.target.value as 'p1' | 'p2')}>
              {PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}
            </select>
          </label>
          <button className="text-sm underline" onClick={() => setModal({ kind: 'keys' })} aria-label="Keyboard shortcuts">?</button>
          <button className="text-sm underline" onClick={toggleTheme} aria-label="Toggle dark mode">Theme</button>
          {onSignOut && <button className="text-sm underline" title={email} onClick={() => { if (!pending || confirm('Some changes have not synced yet. Signing out now may lose them. Sign out anyway?')) onSignOut() }}>Sign out</button>}
        </span>
      </header>
      <Inventory view={view} search={search} selected={selected} setSelected={setSelected} onSell={(r) => setModal({ kind: 'sell', row: r })} />
      <span className="sr-only">{rows.length} items loaded</span>
      {modal?.kind === 'add' && <QuickAdd owner={owner} onClose={() => setModal(null)} />}
      {modal?.kind === 'sell' && <QuickSell initial={modal.row} onClose={() => setModal(null)} />}
      {modal?.kind === 'keys' && <CheatSheet onClose={() => setModal(null)} />}
      {modal?.kind === 'import' && <ImportWizard onClose={() => setModal(null)} />}
      <Toasts />
    </div>
  )
}

const DEMO = import.meta.env.DEV && new URLSearchParams(location.search).has('demo')

export function App() {
  const { acting } = useActingProfile()
  const [user, setUser] = useState<User | null | undefined>(undefined)
  useEffect(() => (auth ? onAuthStateChanged(auth, setUser) : undefined), [])
  const source = useMemo<DataSource | null>(() => (DEMO ? demoSource(new URLSearchParams(location.search).get('demo') === 'empty') : db && user ? firestoreSource(db) : null), [user])

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
