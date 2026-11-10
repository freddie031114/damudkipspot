import { Modal } from './common'

const KEYS: [string, string][] = [
  ['Ctrl+K', 'Command palette: any screen, action or card'], ['/', 'Search'], ['N', 'Add stock'], ['S', 'Quick sell'], ['Ctrl+Z', 'Undo last change'],
  ['G then I D S R E P T A', 'Go to Inventory, Dashboard, Shows, Sales, Expenses, Reprice, Trash, Audit'],
  ['1 / 2 / 3', "View Freddie's / Ferrell's / both people's stock"], ['Delete', 'Delete selected items'],
  ['Enter', 'Edit focused cell, or confirm'], ['Esc', 'Cancel edit / close'], ['↑ ↓ Enter', 'Move and pick in quick sell'],
  ['Ctrl+1–3', 'Payment for the balance: cash, card, PayID'], ['Ctrl+Enter', 'Complete the sale in Show mode'], ['?', 'This cheat sheet'],
]

export function CheatSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={onClose}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {KEYS.map(([k, d]) => (<div key={k} className="contents"><dt><kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-xs">{k}</kbd></dt><dd>{d}</dd></div>))}
      </dl>
      <p className="mt-3 text-xs opacity-70">Single-key shortcuts are off while you are typing in a field.</p>
    </Modal>
  )
}
