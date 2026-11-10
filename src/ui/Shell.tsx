import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { InventoryRow } from '../data/derive'
import { useStore } from '../data/store'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile } from '../lib/profile'
import { applyPwaUpdate, PWA_UPDATE_EVENT } from '../lib/pwa'
import { toggleTheme } from '../lib/theme'
import { CheatSheet } from './CheatSheet'
import { CommandPalette } from './CommandPalette'
import { btnCls, ghostBtn, isTyping } from './common'
import { ImportWizard } from './ImportWizard'
import { Inventory, type View } from './Inventory'
import { ItemDrawer } from './ItemDrawer'
import { Wordmark } from './Logo'
import { QuickAdd } from './QuickAdd'
import { QuickSell } from './QuickSell'
import { UiContext, useUi } from './UiContext'

// Pages other than the inventory load on demand, which keeps the first screen fast.
const Dashboard = lazy(() => import('../pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const ShowsPage = lazy(() => import('../pages/Shows').then((m) => ({ default: m.ShowsPage })))
const ShowDetail = lazy(() => import('../pages/ShowDetail').then((m) => ({ default: m.ShowDetail })))
const ShowMode = lazy(() => import('../pages/ShowMode').then((m) => ({ default: m.ShowMode })))
const SalesPage = lazy(() => import('../pages/Sales').then((m) => ({ default: m.SalesPage })))
const TrashPage = lazy(() => import('../pages/Trash').then((m) => ({ default: m.TrashPage })))
const AuditPage = lazy(() => import('../pages/Audit').then((m) => ({ default: m.AuditPage })))
const SettingsPage = lazy(() => import('../pages/Settings').then((m) => ({ default: m.SettingsPage })))
const RepricePage = lazy(() => import('../pages/Reprice').then((m) => ({ default: m.RepricePage })))

function UpdateBanner() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const on = () => setReady(true)
    window.addEventListener(PWA_UPDATE_EVENT, on)
    return () => window.removeEventListener(PWA_UPDATE_EVENT, on)
  }, [])
  if (!ready) return null
  return (
    <div role="status" className="flex items-center justify-center gap-3 bg-brand px-4 py-1.5 text-sm text-brand-fg">
      A new version is ready.
      <button className="rounded border border-current px-2 py-0.5 font-semibold" onClick={applyPwaUpdate}>Reload now</button>
      <span className="opacity-80">Finish any sale first.</span>
    </div>
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

const NAV: { to: string; label: string; end?: boolean }[] = [
  { to: '/', label: 'Inventory', end: true },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/shows', label: 'Shows' },
  { to: '/sales', label: 'Sales' },
  { to: '/reprice', label: 'Reprice' },
  { to: '/trash', label: 'Trash' },
  { to: '/audit', label: 'Audit' },
  { to: '/settings', label: 'Settings' },
]

// "g" then a letter jumps to a screen.
const GO: Record<string, string> = { i: '/', d: '/dashboard', s: '/shows', r: '/sales', p: '/reprice', t: '/trash', a: '/audit' }

export function Shell({ email, onSignOut }: { email: string; onSignOut?: () => void }) {
  const { acting, setActing } = useActingProfile()
  const { undo, canUndo, pending } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [view, setView] = useState<View>(acting ?? 'p1')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<null | { kind: 'add' } | { kind: 'sell'; row?: InventoryRow } | { kind: 'keys' } | { kind: 'import' } | { kind: 'palette' }>(null)
  const [itemId, setItemId] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const goPending = useRef(0)
  const fullScreen = location.pathname.startsWith('/show/')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setModal((m) => (m?.kind === 'palette' ? null : { kind: 'palette' })); return }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isTyping(e.target)) { e.preventDefault(); undo(); return }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target) || modal || itemId) return
      if (goPending.current && Date.now() - goPending.current < 1200) {
        goPending.current = 0
        const dest = GO[e.key.toLowerCase()]
        if (dest) { e.preventDefault(); navigate(dest) }
        return
      }
      if (e.key === 'g') goPending.current = Date.now()
      else if (e.key === '/') { e.preventDefault(); navigate('/'); searchRef.current?.focus() }
      else if (e.key === 'n') { e.preventDefault(); setModal({ kind: 'add' }) }
      else if (e.key === 's') { e.preventDefault(); setModal({ kind: 'sell' }) }
      else if (e.key === '?') setModal({ kind: 'keys' })
      else if (e.key === '1') setView('p1')
      else if (e.key === '2') setView('p2')
      else if (e.key === '3') setView('all')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, modal, itemId, navigate])

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

  const ui = {
    view, setView, search, setSearch,
    openAdd: () => setModal({ kind: 'add' }),
    openSell: (row?: InventoryRow) => setModal({ kind: 'sell', row }),
    openImport: () => setModal({ kind: 'import' }),
    openKeys: () => setModal({ kind: 'keys' }),
    openItem: (id: string) => setItemId(id),
  }

  return (
    <UiContext.Provider value={ui}>
      <div className="flex h-screen flex-col">
        <UpdateBanner />
        {!fullScreen && (
          <header className="border-b border-line">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
              <Wordmark />
              <nav className="flex gap-1" aria-label="Inventory view">
                {tab('p1', DEFAULT_NAMES.p1, '1')}{tab('p2', DEFAULT_NAMES.p2, '2')}{tab('all', 'Combined', '3')}
              </nav>
              <input ref={searchRef} aria-label="Search inventory" placeholder="Search  ( / )" value={search}
                onChange={(e) => { setSearch(e.target.value); if (location.pathname !== '/') navigate('/') }}
                onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur() } }}
                className="min-w-40 max-w-md flex-1 rounded border border-line bg-transparent px-3 py-1.5" />
              <button className={btnCls} onClick={ui.openAdd}>Add (N)</button>
              <button className={btnCls} onClick={() => ui.openSell()}>Sell (S)</button>
              <button className={ghostBtn} onClick={ui.openImport}>Import</button>
              <button className={ghostBtn} onClick={undo} disabled={!canUndo}>Undo</button>
              <span className="ml-auto flex flex-wrap items-center gap-3">
                <StatusPill />
                <label className="text-sm">Using as{' '}
                  <select aria-label="Acting profile" className="rounded border border-line bg-transparent px-1 py-0.5" value={acting ?? ''} onChange={(e) => setActing(e.target.value as 'p1' | 'p2')}>
                    {PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}
                  </select>
                </label>
                <button className="text-sm underline" onClick={ui.openKeys} aria-label="Keyboard shortcuts">?</button>
                <button className="text-sm underline" onClick={toggleTheme} aria-label="Toggle dark mode">Theme</button>
                {onSignOut && <button className="text-sm underline" title={email} onClick={() => { if (!pending || confirm('Some changes have not synced yet. Signing out now may lose them. Sign out anyway?')) onSignOut() }}>Sign out</button>}
              </span>
            </div>
            <nav className="flex gap-1 overflow-x-auto px-4 pb-1.5" aria-label="Screens">
              {NAV.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end}
                  className={({ isActive }) => `rounded px-3 py-1 text-sm ${isActive ? 'bg-chip font-semibold' : 'hover:bg-hover'}`}>
                  {n.label}
                </NavLink>
              ))}
            </nav>
          </header>
        )}

        <Suspense fallback={<p className="p-6">Loading…</p>}>
          <Routes>
            <Route path="/" element={<InventoryScreen />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/shows" element={<ShowsPage />} />
            <Route path="/shows/:id" element={<ShowDetail />} />
            <Route path="/show/:id" element={<ShowMode />} />
            <Route path="/sales" element={<SalesPage />} />
            <Route path="/reprice" element={<RepricePage />} />
            <Route path="/trash" element={<TrashPage />} />
            <Route path="/audit" element={<AuditPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<p className="p-6">That page does not exist.</p>} />
          </Routes>
        </Suspense>

        {modal?.kind === 'add' && <QuickAdd owner={owner} onClose={() => setModal(null)} />}
        {modal?.kind === 'sell' && <QuickSell initial={modal.row} onClose={() => setModal(null)} />}
        {modal?.kind === 'keys' && <CheatSheet onClose={() => setModal(null)} />}
        {modal?.kind === 'palette' && <CommandPalette onClose={() => setModal(null)} />}
        {modal?.kind === 'import' && <ImportWizard onClose={() => setModal(null)} />}
        {itemId && <ItemDrawer itemId={itemId} onClose={() => setItemId(null)} />}
        <Toasts />
      </div>
    </UiContext.Provider>
  )
}

function InventoryScreen() {
  const { view, search, openSell } = useUi()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  return <Inventory view={view} search={search} selected={selected} setSelected={setSelected} onSell={(r) => openSell(r)} />
}

