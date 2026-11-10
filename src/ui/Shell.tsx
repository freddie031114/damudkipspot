import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { InventoryRow } from '../data/derive'
import { useStore } from '../data/store'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile, type ProfileId } from '../lib/profile'
import { applyPwaUpdate, PWA_UPDATE_EVENT } from '../lib/pwa'
import { toggleTheme } from '../lib/theme'
import { useIsMobile } from '../lib/useMedia'
import { CheatSheet } from './CheatSheet'
import { CommandPalette } from './CommandPalette'
import { accentBtn, btnCls, ghostBtn, isTyping } from './common'
import { Icon } from './icons'
import { Inventory, type View } from './Inventory'
import { MobileChrome } from './MobileChrome'
import { MobileInventory } from './MobileInventory'
import { Wordmark } from './Logo'
import { QuickAdd } from './QuickAdd'
import { QuickSell } from './QuickSell'
import { UiContext, useUi } from './UiContext'

// Everything except the inventory loads on demand, which keeps the first screen fast.
const ImportWizard = lazy(() => import('./ImportWizard').then((m) => ({ default: m.ImportWizard })))
const ItemDrawer = lazy(() => import('./ItemDrawer').then((m) => ({ default: m.ItemDrawer })))
const Dashboard = lazy(() => import('../pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const ShowsPage = lazy(() => import('../pages/Shows').then((m) => ({ default: m.ShowsPage })))
const ShowDetail = lazy(() => import('../pages/ShowDetail').then((m) => ({ default: m.ShowDetail })))
const ShowMode = lazy(() => import('../pages/ShowMode').then((m) => ({ default: m.ShowMode })))
const SalesPage = lazy(() => import('../pages/Sales').then((m) => ({ default: m.SalesPage })))
const TrashPage = lazy(() => import('../pages/Trash').then((m) => ({ default: m.TrashPage })))
const AuditPage = lazy(() => import('../pages/Audit').then((m) => ({ default: m.AuditPage })))
const SettingsPage = lazy(() => import('../pages/Settings').then((m) => ({ default: m.SettingsPage })))
const ExpensesPage = lazy(() => import('../pages/Expenses').then((m) => ({ default: m.ExpensesPage })))
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
      <button className="rounded-md border border-current px-2 py-0.5 font-semibold" onClick={applyPwaUpdate}>Reload now</button>
      <span className="opacity-80">Finish any sale first.</span>
    </div>
  )
}

function StatusPill() {
  const { online, pending } = useStore()
  const text = !online ? (pending ? 'Offline · saved here, will sync' : 'Offline') : pending ? 'Syncing…' : 'All changes synced'
  const dot = !online ? 'bg-accent' : pending ? 'bg-brand' : 'bg-emerald-400'
  return (
    <span role="status" className="flex items-center gap-2 text-xs text-side-ink/90">
      <span className={`h-2 w-2 rounded-full ${dot} ${pending ? 'animate-pulse' : ''}`} />
      {text}
    </span>
  )
}

function Toasts() {
  const { toast, dismissToast } = useStore()
  if (!toast) return null
  return (
    <div role="status" aria-live="polite" className={`fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2.5 text-sm shadow-pop max-md:bottom-24 max-md:left-3 max-md:right-3 max-md:translate-x-0 max-md:justify-between ${toast.error ? 'bg-red-600 text-white' : 'bg-ink text-page'}`}>
      <span>{toast.text}</span>
      {toast.undo && <button className="font-semibold underline underline-offset-2" onClick={() => { toast.undo!(); dismissToast() }}>Undo</button>}
      <button aria-label="Dismiss" className="opacity-70 hover:opacity-100" onClick={dismissToast}>×</button>
    </div>
  )
}

const NAV: { to: string; label: string; icon: keyof typeof Icon; end?: boolean }[] = [
  { to: '/', label: 'Inventory', icon: 'inventory', end: true },
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/shows', label: 'Shows', icon: 'shows' },
  { to: '/sales', label: 'Sales', icon: 'sales' },
  { to: '/expenses', label: 'Expenses', icon: 'expenses' },
  { to: '/reprice', label: 'Reprice', icon: 'reprice' },
  { to: '/trash', label: 'Trash', icon: 'trash' },
  { to: '/audit', label: 'Audit log', icon: 'audit' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

// "g" then a letter jumps to a screen.
const GO: Record<string, string> = { i: '/', d: '/dashboard', s: '/shows', r: '/sales', e: '/expenses', p: '/reprice', t: '/trash', a: '/audit' }

const DOT: Record<ProfileId, string> = { p1: 'bg-brand', p2: 'bg-accent' }

function Avatar({ p, size = 28 }: { p: ProfileId; size?: number }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${p === 'p1' ? 'bg-brand text-brand-fg' : 'bg-accent text-[#2b1600]'}`} style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {DEFAULT_NAMES[p].charAt(0)}
    </span>
  )
}

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

  const ui = {
    view, setView, search, setSearch,
    openAdd: () => setModal({ kind: 'add' }),
    openSell: (row?: InventoryRow) => setModal({ kind: 'sell', row }),
    openImport: () => setModal({ kind: 'import' }),
    openKeys: () => setModal({ kind: 'keys' }),
    openItem: (id: string) => setItemId(id),
  }

  const signOut = onSignOut && (() => { if (!pending || confirm('Some changes have not synced yet. Signing out now may lose them. Sign out anyway?')) onSignOut() })

  const routes = (
  <Suspense fallback={<p className="p-6 opacity-70">Loading…</p>}>
    <Routes>
      <Route path="/" element={<InventoryScreen />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/shows" element={<ShowsPage />} />
      <Route path="/shows/:id" element={<ShowDetail />} />
      <Route path="/show/:id" element={<ShowMode />} />
      <Route path="/sales" element={<SalesPage />} />
      <Route path="/expenses" element={<ExpensesPage />} />
      <Route path="/reprice" element={<RepricePage />} />
      <Route path="/trash" element={<TrashPage />} />
      <Route path="/audit" element={<AuditPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<p className="p-6">That page does not exist.</p>} />
    </Routes>
  </Suspense>
  )

  const isMobile = useIsMobile()
  const overlays = (
    <>
      {modal?.kind === 'add' && <QuickAdd owner={view === 'all' ? (acting ?? 'p1') : view} onClose={() => setModal(null)} />}
      {modal?.kind === 'sell' && <QuickSell initial={modal.row} onClose={() => setModal(null)} />}
      {modal?.kind === 'keys' && <CheatSheet onClose={() => setModal(null)} />}
      {modal?.kind === 'palette' && <CommandPalette onClose={() => setModal(null)} />}
      <Suspense fallback={null}>
        {modal?.kind === 'import' && <ImportWizard onClose={() => setModal(null)} />}
        {itemId && <ItemDrawer itemId={itemId} onClose={() => setItemId(null)} />}
      </Suspense>
      <Toasts />
    </>
  )

  // Phones get their own layout: top bar, bottom tabs, card lists. Show mode is full screen on both.
  if (isMobile && !fullScreen) {
    return (
      <UiContext.Provider value={ui}>
        <MobileChrome view={view} setView={setView} onSell={() => setModal({ kind: 'sell' })} onImport={ui.openImport} signOut={signOut} banner={<UpdateBanner />}>
          {routes}
        </MobileChrome>
        {overlays}
      </UiContext.Provider>
    )
  }

  return (
    <UiContext.Provider value={ui}>
      <div className="flex h-dvh flex-col">
        <UpdateBanner />
        <div className="flex min-h-0 flex-1">
          {!fullScreen && (
            <aside className="hidden w-60 shrink-0 flex-col bg-side px-3 py-4 text-side-ink md:flex" aria-label="Sidebar">
              <div className="px-2 pb-4 text-white"><Wordmark /></div>

              <div className="mb-4 rounded-xl bg-white/5 p-1" role="group" aria-label="Whose stock">
                <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-widest text-side-ink/60">Viewing</p>
                <div className="grid grid-cols-2 gap-1">
                  {PROFILE_IDS.map((p, i) => (
                    <button key={p} aria-pressed={view === p} onClick={() => setView(p)}
                      className={`flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${view === p ? 'bg-white/15 font-semibold text-white shadow-sm' : 'hover:bg-white/10'}`}>
                      <span className={`h-2 w-2 rounded-full ${DOT[p]}`} />{DEFAULT_NAMES[p]}<span className="text-[10px] opacity-50">{i + 1}</span>
                    </button>
                  ))}
                  <button aria-pressed={view === 'all'} onClick={() => setView('all')}
                    className={`col-span-2 flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm transition-colors ${view === 'all' ? 'bg-white/15 font-semibold text-white shadow-sm' : 'hover:bg-white/10'}`}>
                    <span className="flex"><span className={`h-2 w-2 rounded-full ${DOT.p1}`} /><span className={`-ml-0.5 h-2 w-2 rounded-full ${DOT.p2}`} /></span>Combined<span className="text-[10px] opacity-50">3</span>
                  </button>
                </div>
              </div>

              <nav className="flex flex-1 flex-col gap-0.5" aria-label="Screens">
                {NAV.map((n) => (
                  <NavLink key={n.to} to={n.to} end={n.end}
                    className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? 'bg-white/12 font-medium text-white shadow-[inset_3px_0_0_var(--accent)]' : 'text-side-ink/80 hover:bg-white/8 hover:text-white'}`}>
                    {Icon[n.icon](18)}{n.label}
                  </NavLink>
                ))}
              </nav>

              <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
                <StatusPill />
                <label className="flex items-center gap-2 rounded-xl bg-white/5 px-2 py-1.5">
                  {acting && <Avatar p={acting} />}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10px] uppercase tracking-widest text-side-ink/60">Using as</span>
                    <select aria-label="Acting profile" className="w-full cursor-pointer bg-transparent text-sm font-medium text-white outline-none" value={acting ?? ''} onChange={(e) => setActing(e.target.value as ProfileId)}>
                      {PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}
                    </select>
                  </span>
                </label>
                <div className="flex items-center justify-between px-1 text-side-ink/80">
                  <button className="rounded-md p-1.5 hover:bg-white/10 hover:text-white" onClick={toggleTheme} aria-label="Toggle dark mode" title="Light / dark">{Icon.moon(17)}</button>
                  <button className="rounded-md p-1.5 hover:bg-white/10 hover:text-white" onClick={ui.openKeys} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">{Icon.help(17)}</button>
                  {signOut && <button className="rounded-md p-1.5 hover:bg-white/10 hover:text-white" onClick={signOut} aria-label="Sign out" title={`Sign out (${email})`}>{Icon.logout(17)}</button>}
                </div>
              </div>
            </aside>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            {!fullScreen && (
              <header className="border-b border-line bg-surface/80 backdrop-blur">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 md:px-6">
                  <div className="relative min-w-44 max-w-xl flex-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50">{Icon.search(16)}</span>
                    <input ref={searchRef} aria-label="Search inventory" placeholder="Search your stock" value={search}
                      onChange={(e) => { setSearch(e.target.value); if (location.pathname !== '/') navigate('/') }}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur() } }}
                      className="w-full rounded-xl border border-transparent bg-hover py-2 pl-9 pr-12 text-sm outline-none focus-visible:outline-none transition-colors placeholder:opacity-60 focus:border-brand focus:bg-surface" />
                    <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-line bg-surface px-1.5 text-[11px] opacity-70">/</kbd>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <button className={ghostBtn} onClick={() => setModal({ kind: 'palette' })} aria-label="Command palette" title="Command palette (Ctrl+K)">{Icon.command(15)}<span className="hidden text-xs opacity-70 lg:inline">Ctrl K</span></button>
                    <button className={ghostBtn} onClick={ui.openImport}>{Icon.upload(15)}<span className="hidden sm:inline">Import</span></button>
                    <button className={ghostBtn} onClick={undo} disabled={!canUndo} aria-label="Undo">{Icon.undo(15)}<span className="hidden sm:inline">Undo</span></button>
                    <button className={btnCls} onClick={ui.openAdd}>{Icon.plus(16)}Add<kbd className="ml-0.5 hidden rounded bg-white/20 px-1 text-[10px] lg:inline">N</kbd></button>
                    <button className={accentBtn} onClick={() => ui.openSell()}>{Icon.cash(16)}Sell<kbd className="ml-0.5 hidden rounded bg-black/10 px-1 text-[10px] lg:inline">S</kbd></button>
                  </div>
                </div>
              </header>
            )}

            {routes}
          </div>
        </div>

        {overlays}
      </div>
    </UiContext.Provider>
  )
}

function InventoryScreen() {
  const { view, search, openSell } = useUi()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  if (useIsMobile()) return <MobileInventory />
  return <Inventory view={view} search={search} selected={selected} setSelected={setSelected} onSell={(r) => openSell(r)} />
}
