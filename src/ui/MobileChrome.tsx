import { useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../data/store'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile, type ProfileId } from '../lib/profile'
import { toggleTheme } from '../lib/theme'
import { BottomSheet } from './common'
import { Icon } from './icons'
import type { View } from './Inventory'
import { Logo, Wordmark } from './Logo'

const MORE: { to: string; label: string; icon: keyof typeof Icon }[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/sales', label: 'Sales and trades', icon: 'sales' },
  { to: '/reprice', label: 'Reprice', icon: 'reprice' },
  { to: '/trash', label: 'Trash', icon: 'trash' },
  { to: '/audit', label: 'Audit log', icon: 'audit' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

/** Screens where "whose stock" matters, so the switch is worth the space. */
const SWITCH_ON = new Set(['/', '/dashboard', '/reprice'])

const DOT: Record<ProfileId, string> = { p1: 'bg-brand', p2: 'bg-accent' }

function ViewSwitch({ view, setView }: { view: View; setView: (v: View) => void }) {
  const items: { id: View; label: string }[] = [...PROFILE_IDS.map((p) => ({ id: p as View, label: DEFAULT_NAMES[p] })), { id: 'all', label: 'Both' }]
  return (
    <div className="flex min-w-0 flex-1 gap-1 rounded-xl bg-hover p-1" role="group" aria-label="Whose stock">
      {items.map((it) => (
        <button key={it.id} aria-pressed={view === it.id} onClick={() => setView(it.id)}
          className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm transition-colors ${view === it.id ? 'bg-surface font-semibold shadow-sm' : 'opacity-70'}`}>
          {it.id === 'all'
            ? <span className="flex"><span className={`h-2 w-2 rounded-full ${DOT.p1}`} /><span className={`-ml-0.5 h-2 w-2 rounded-full ${DOT.p2}`} /></span>
            : <span className={`h-2 w-2 rounded-full ${DOT[it.id as ProfileId]}`} />}
          <span className="truncate">{it.label}</span>
        </button>
      ))}
    </div>
  )
}

const tabCls = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'font-semibold text-brand' : 'opacity-70'}`

/**
 * The phone layout: a slim top bar, the screen, and a bottom tab bar with Sell in the middle.
 * Less-used screens live behind "More". The desktop sidebar layout is separate (see Shell).
 */
export function MobileChrome({ view, setView, onSell, onImport, signOut, banner, children }: {
  view: View
  setView: (v: View) => void
  onSell: () => void
  onImport: () => void
  signOut?: () => void
  banner?: ReactNode
  children: ReactNode
}) {
  const { undo, canUndo, pending, online } = useStore()
  const { acting, setActing } = useActingProfile()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [more, setMore] = useState(false)
  const onMoreScreen = MORE.some((m) => pathname.startsWith(m.to))
  const status = !online ? (pending ? 'Offline · saved here, will sync' : 'Offline') : pending ? 'Syncing…' : 'All changes synced'
  const dot = !online ? 'bg-accent' : pending ? 'bg-brand animate-pulse' : 'bg-emerald-400'

  return (
    <div className="flex h-dvh flex-col">
      {banner}
      <header className="pt-safe shrink-0 border-b border-line bg-surface">
        <div className="flex items-center gap-2 px-3 py-2">
          {SWITCH_ON.has(pathname) ? <><Logo size={30} /><ViewSwitch view={view} setView={setView} /></> : <span className="flex-1 text-ink"><Wordmark /></span>}
          <button aria-label="Undo" onClick={undo} disabled={!canUndo} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-hover disabled:opacity-30">{Icon.undo(20)}</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>

      <nav className="pb-safe relative z-20 shrink-0 border-t border-line bg-surface" aria-label="Screens (mobile)">
        <div className="grid grid-cols-5 items-end">
          <NavLink to="/" end className={tabCls}>{Icon.inventory(22)}Stock</NavLink>
          <NavLink to="/shows" className={tabCls}>{Icon.shows(22)}Shows</NavLink>
          <button onClick={onSell} aria-label="Log a deal" className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold">
            <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-[#2b1600] shadow-pop active:scale-95">{Icon.cash(24)}</span>Deal
          </button>
          <NavLink to="/expenses" className={tabCls}>{Icon.expenses(22)}Costs</NavLink>
          <button onClick={() => setMore(true)} className={`${tabCls({ isActive: onMoreScreen })} w-full`} aria-label="More">{Icon.more(22)}More</button>
        </div>
      </nav>

      {more && (
        <BottomSheet title="More" onClose={() => setMore(false)}>
          <ul className="mb-3 grid grid-cols-2 gap-2">
            {MORE.map((m) => (
              <li key={m.to}>
                <button onClick={() => { setMore(false); navigate(m.to) }}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-xl border border-line px-3 text-left text-sm ${pathname.startsWith(m.to) ? 'bg-hover font-semibold' : ''}`}>
                  {Icon[m.icon](20)}{m.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="mb-3 flex gap-2">
            <button className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm" onClick={() => { setMore(false); onImport() }}>{Icon.upload(18)}Import</button>
            <button className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm" onClick={toggleTheme}>{Icon.moon(18)}Dark mode</button>
            {signOut && <button className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm" onClick={signOut}>{Icon.logout(18)}Sign out</button>}
          </div>
          <label className="flex items-center justify-between gap-3 rounded-xl bg-hover px-3 py-2 text-sm">
            <span><span className="block text-[10px] uppercase tracking-widest opacity-60">Using as</span>Recorded on every sale and change</span>
            <select aria-label="Acting profile" className="rounded-lg border border-line bg-surface px-2 py-1.5 font-semibold" value={acting ?? ''} onChange={(e) => setActing(e.target.value as ProfileId)}>
              {PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}
            </select>
          </label>
          <p role="status" className="mt-3 flex items-center gap-2 text-xs opacity-80"><span className={`h-2 w-2 rounded-full ${dot}`} />{status}</p>
        </BottomSheet>
      )}
    </div>
  )
}
