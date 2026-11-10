import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { matchesSearch } from '../data/derive'
import { useStore } from '../data/store'
import { formatAud } from '../domain/money'
import { DEFAULT_NAMES } from '../lib/profile'
import { toggleTheme } from '../lib/theme'
import { Modal, inputCls } from './common'
import { useUi } from './UiContext'

interface Command {
  id: string
  label: string
  hint?: string
  run: () => void
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const ui = useUi()
  const { rows, undo, canUndo } = useStore()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => navigate(to)
    return [
      { id: 'add', label: 'Add stock', hint: 'N', run: ui.openAdd },
      { id: 'sell', label: 'Quick sell', hint: 'S', run: () => ui.openSell() },
      { id: 'import', label: 'Import stock from a sheet or CSV', run: ui.openImport },
      { id: 'undo', label: 'Undo last change', hint: 'Ctrl+Z', run: () => canUndo && undo() },
      { id: 'inv', label: 'Go to Inventory', hint: 'G I', run: go('/') },
      { id: 'dash', label: 'Go to Dashboard', hint: 'G D', run: go('/dashboard') },
      { id: 'shows', label: 'Go to Shows', hint: 'G S', run: go('/shows') },
      { id: 'sales', label: 'Go to Sales and reports', hint: 'G R', run: go('/sales') },
      { id: 'reprice', label: 'Go to Reprice', hint: 'G P', run: go('/reprice') },
      { id: 'trash', label: 'Go to Trash', hint: 'G T', run: go('/trash') },
      { id: 'audit', label: 'Go to Audit log', hint: 'G A', run: go('/audit') },
      { id: 'settings', label: 'Go to Settings', run: go('/settings') },
      { id: 'v1', label: `View ${DEFAULT_NAMES.p1}'s stock`, hint: '1', run: () => ui.setView('p1') },
      { id: 'v2', label: `View ${DEFAULT_NAMES.p2}'s stock`, hint: '2', run: () => ui.setView('p2') },
      { id: 'v3', label: 'View combined stock', hint: '3', run: () => ui.setView('all') },
      { id: 'theme', label: 'Switch light / dark', run: toggleTheme },
      { id: 'keys', label: 'Keyboard shortcuts', hint: '?', run: ui.openKeys },
    ]
  }, [ui, navigate, undo, canUndo])

  const shownCommands = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return commands.filter((c) => words.every((w) => c.label.toLowerCase().includes(w)))
  }, [commands, q])

  const items = useMemo(() => (q.trim().length >= 2 ? rows.filter((r) => matchesSearch(r.item, q)).slice(0, 6) : []), [rows, q])

  const entries: { key: string; label: string; right?: string; run: () => void }[] = [
    ...shownCommands.map((c) => ({ key: c.id, label: c.label, right: c.hint, run: c.run })),
    ...items.map((r) => ({
      key: r.item.id,
      label: `${r.item.name} ${r.item.cardNumber}`.trim(),
      right: `${DEFAULT_NAMES[r.item.profileId]} · ${r.qty} in stock · ${formatAud(r.sticker)}`,
      run: () => ui.openItem(r.item.id),
    })),
  ]

  const choose = (i: number) => {
    const e = entries[i]
    if (!e) return
    onClose()
    // Let the palette close before the action opens something else.
    setTimeout(e.run, 0)
  }

  return (
    <Modal title="Command palette" onClose={onClose}>
      <input autoFocus className={inputCls} placeholder="Type a command, or a card name…" aria-label="Command" value={q}
        onChange={(e) => { setQ(e.target.value); setCursor(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, entries.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); choose(cursor) }
        }} />
      <ul className="mt-2 max-h-80 overflow-y-auto" role="listbox">
        {entries.map((e, i) => (
          <li key={e.key} role="option" aria-selected={i === cursor} onMouseEnter={() => setCursor(i)} onClick={() => choose(i)}
            className={`flex cursor-pointer justify-between gap-3 rounded px-2 py-1.5 ${i === cursor ? 'bg-brand text-brand-fg' : ''}`}>
            <span className="truncate">{e.label}</span>
            {e.right && <span className="shrink-0 text-sm opacity-70">{e.right}</span>}
          </li>
        ))}
        {entries.length === 0 && <li className="px-2 py-1.5 opacity-60">Nothing matches.</li>}
      </ul>
    </Modal>
  )
}
