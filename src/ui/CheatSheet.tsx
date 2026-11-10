import { Modal } from './common'

const KEYS: [string, string][] = [
  ['/', 'Search'], ['N', 'Add stock'], ['S', 'Quick sell'], ['Ctrl+Z', 'Undo last change'],
  ['1 / 2 / 3', 'View: Me / Friend / Combined'], ['Delete', 'Delete selected items'],
  ['Enter', 'Edit focused cell, or confirm'], ['Esc', 'Cancel edit / close'], ['↑ ↓ Enter', 'Move and pick in quick sell'],
  ['Ctrl+1–4', 'Payment: cash, card, PayID, trade'], ['?', 'This cheat sheet'],
]

export function CheatSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {KEYS.map(([k, d]) => (<div key={k} className="contents"><dt><kbd className="rounded border border-slate-400 px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt><dd>{d}</dd></div>))}
      </dl>
      <p className="mt-3 text-xs opacity-70">Single-key shortcuts are off while you are typing in a field.</p>
    </Modal>
  )
}
