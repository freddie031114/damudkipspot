import { useMemo, useState } from 'react'
import { importItems } from '../data/changes'
import { useChangeCtx, useStore } from '../data/store'
import type { ProfileId } from '../data/types'
import { formatAud, parseMoney } from '../domain/money'
import { stickerFromMarket } from '../domain/sticker'
import { checkMessages } from '../import/checks'
import { parseTable } from '../import/csv'
import { FIELDS, guessMapping, parseGeneric, type Field, type Mapping } from '../import/generic'
import { parseSheetGrid } from '../import/sheet'
import type { ImportRow } from '../import/types'
import { DEFAULT_NAMES, PROFILE_IDS } from '../lib/profile'
import { btnCls, ghostBtn, inputCls, Modal } from './common'

type Preset = 'sheet' | 'generic'
const nameOf = (p: ProfileId) => DEFAULT_NAMES[p]

function OwnerSelect({ value, onChange, label }: { value: ProfileId; onChange: (p: ProfileId) => void; label: string }) {
  return (
    <label className="text-sm">{label}{' '}
      <select className="rounded border border-line bg-transparent px-1 py-0.5" value={value} onChange={(e) => onChange(e.target.value as ProfileId)}>
        {PROFILE_IDS.map((p) => <option key={p} value={p}>{nameOf(p)}</option>)}
      </select>
    </label>
  )
}

export function ImportWizard({ onClose }: { onClose: () => void }) {
  const { raw, apply, notify } = useStore()
  const ctx = useChangeCtx()
  const [preset, setPreset] = useState<Preset>('sheet')
  const [text, setText] = useState('')
  const [filename, setFilename] = useState('pasted data')
  const [left, setLeft] = useState<ProfileId>('p2')
  const [right, setRight] = useState<ProfileId>('p1')
  const [owner, setOwner] = useState<ProfileId>('p1')
  const [rate, setRate] = useState('1')
  const [mapping, setMapping] = useState<Mapping>({})
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [messages, setMessages] = useState<{ ok: boolean; text: string }[]>([])
  const [error, setError] = useState('')

  const grid = useMemo(() => (text.trim() ? parseTable(text) : []), [text])
  const headers = grid[0] ?? []
  const existing = raw.items.filter((i) => !i.deletedAt).length

  async function onFile(f: File | undefined) {
    if (!f) return
    const t = await f.text()
    setText(t)
    setFilename(f.name)
    setError('')
    if (preset === 'generic') setMapping(guessMapping(parseTable(t)[0] ?? []))
  }

  function onText(t: string) {
    setText(t)
    if (preset === 'generic') setMapping(guessMapping(parseTable(t)[0] ?? []))
  }

  function preview() {
    setError('')
    if (grid.length === 0) return setError('Choose a file or paste your data first.')
    if (preset === 'sheet') {
      const res = parseSheetGrid(grid, [left, right])
      if (res.errors.length) return setError(res.errors.join(' '))
      setRows(res.rows)
      setMessages(checkMessages(res.checks, nameOf))
    } else {
      const res = parseGeneric(grid, mapping, { profileId: owner, rate: Number(rate) })
      if (res.errors.length) return setError(res.errors.join(' '))
      setRows(res.rows)
      setMessages([])
    }
  }

  const patch = (key: string, p: Partial<ImportRow>) => setRows((rs) => rs && rs.map((r) => (r.key === key ? { ...r, ...p } : r)))

  const usable = (r: ImportRow) => r.include && r.marketCents !== null && r.blocking.length === 0 && r.name.trim() !== ''
  const summary = useMemo(() => {
    const out = new Map<ProfileId, { items: number; units: number; value: number }>()
    for (const r of rows ?? []) {
      if (!usable(r)) continue
      const s = out.get(r.profileId) ?? { items: 0, units: 0, value: 0 }
      s.items++
      s.units += r.qty
      s.value += r.qty * (r.marketCents ?? 0)
      out.set(r.profileId, s)
    }
    return out
  }, [rows])

  function runImport() {
    try {
      const clean = rows!.map((r) => (usable(r) ? r : { ...r, include: false }))
      const change = importItems(ctx(), clean, filename)
      apply(change)
      onClose()
    } catch (e) {
      notify((e as Error).message, true)
    }
  }

  // ---------- step 1: choose data ----------
  if (!rows) {
    return (
      <Modal title="Import stock" onClose={onClose} xl>
        <div className="mb-3 flex gap-4 text-sm" role="radiogroup" aria-label="Import type">
          <label className="flex items-center gap-1"><input type="radio" checked={preset === 'sheet'} onChange={() => setPreset('sheet')} /> Our Google Sheet (two blocks side by side)</label>
          <label className="flex items-center gap-1"><input type="radio" checked={preset === 'generic'} onChange={() => { setPreset('generic'); setMapping(guessMapping(headers)) }} /> Other CSV (Collectr, etc.)</label>
        </div>
        <p className="mb-2 text-sm opacity-80">
          {preset === 'sheet'
            ? 'In Google Sheets choose File → Download → Comma-separated values (.csv), then pick the file here. Or select all the cells, copy, and paste below.'
            : 'Pick a CSV export, or paste rows copied from a spreadsheet. The first row must be the column names.'}
        </p>
        <div className="mb-2 flex items-center gap-3">
          <input type="file" accept=".csv,.tsv,.txt,text/csv" aria-label="Choose file" onChange={(e) => void onFile(e.target.files?.[0])} />
          {text && <span className="text-sm opacity-70">{grid.length} rows loaded</span>}
        </div>
        <textarea aria-label="Paste data" className={`${inputCls} h-28 font-mono text-xs`} placeholder="…or paste here" value={text} onChange={(e) => onText(e.target.value)} />

        {preset === 'sheet' ? (
          <div className="mt-3 flex flex-wrap gap-4">
            <OwnerSelect label="Left block belongs to" value={left} onChange={setLeft} />
            <OwnerSelect label="Right block belongs to" value={right} onChange={setRight} />
          </div>
        ) : (
          <div className="mt-3">
            <div className="mb-2 flex flex-wrap items-center gap-4">
              <OwnerSelect label="Stock belongs to" value={owner} onChange={setOwner} />
              <label className="text-sm">Multiply prices by{' '}
                <input className="w-20 rounded border border-line bg-transparent px-1 py-0.5" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} aria-label="Price multiplier" />
                <span className="ml-1 text-xs opacity-70">(1 if already in AUD; use the USD to AUD rate otherwise)</span>
              </label>
            </div>
            {headers.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {FIELDS.map((f) => (
                  <label key={f.id} className="text-xs font-medium">{f.label}{f.required && ' *'}
                    <select className={inputCls} value={mapping[f.id] ?? ''} aria-label={`Column for ${f.label}`}
                      onChange={(e) => setMapping((m) => { const n = { ...m } as Mapping; if (e.target.value === '') delete n[f.id as Field]; else n[f.id as Field] = Number(e.target.value); return n })}>
                      <option value="">(none)</option>
                      {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className={ghostBtn} onClick={onClose}>Cancel</button>
          <button className={btnCls} onClick={preview} disabled={!text.trim()}>Preview</button>
        </div>
      </Modal>
    )
  }

  // ---------- step 2: review ----------
  const blocked = rows.filter((r) => r.blocking.length > 0).length
  const total = [...summary.values()].reduce((n, s) => n + s.items, 0)
  return (
    <Modal title="Review import" onClose={onClose} xl>
      {existing > 0 && (
        <p className="mb-2 rounded border border-accent px-2 py-1 text-sm">
          You already have {existing} items. Importing adds these on top, so importing the same file twice creates duplicates. You can undo right after importing.
        </p>
      )}
      {messages.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-sm" aria-label="Checks against the sheet">
          {messages.map((m, i) => <li key={i} className={m.ok ? '' : 'text-accent-ink'}>{m.ok ? '✓' : '⚠'} {m.text}</li>)}
        </ul>
      )}
      <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-sm" aria-label="Import summary">
        {[...summary.entries()].map(([p, s]) => (
          <span key={p}><strong>{nameOf(p)}</strong>: {s.items} items, {s.units} units, market value <strong>{formatAud(s.value)}</strong></span>
        ))}
        {blocked > 0 && <span className="text-accent-ink">{blocked} row(s) can't be imported until fixed</span>}
      </div>

      <div className="max-h-[48vh] overflow-auto rounded border border-line">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-surface text-xs uppercase tracking-wide">
            <tr>
              <th className="p-1.5"><span className="sr-only">Include</span></th><th className="p-1.5">Owner</th><th className="p-1.5">Name</th>
              <th className="p-1.5">Number</th><th className="p-1.5">Qty</th><th className="p-1.5 text-right">Market</th>
              <th className="p-1.5 text-right">Sticker</th><th className="p-1.5">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sticker = r.stickerOverrideCents ?? (r.marketCents === null ? null : stickerFromMarket(r.marketCents))
              return (
                <tr key={r.key} className={`border-t border-line align-top ${r.include ? '' : 'opacity-50'}`}>
                  <td className="p-1.5"><input type="checkbox" aria-label={`Include ${r.name}`} checked={r.include} disabled={r.blocking.length > 0} onChange={(e) => patch(r.key, { include: e.target.checked })} /></td>
                  <td className="p-1.5">{nameOf(r.profileId)}</td>
                  <td className="p-1.5"><input className="w-full min-w-40 rounded border border-transparent bg-transparent px-1 hover:border-line" aria-label={`Name for ${r.source}`} defaultValue={r.name} onBlur={(e) => patch(r.key, { name: e.target.value, blocking: e.target.value.trim() ? r.blocking.filter((b) => b !== 'No name') : r.blocking })} />
                    <div className="px-1 text-xs opacity-60">{[r.kind !== 'single' && r.kind, r.gradingCompany && `${r.gradingCompany} ${r.grade}`, r.variant, r.condition, r.language !== 'EN' && r.language, r.game !== 'Pokémon' && r.game].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="p-1.5"><input className="w-24 rounded border border-transparent bg-transparent px-1 hover:border-line" aria-label={`Number for ${r.source}`} defaultValue={r.cardNumber} onBlur={(e) => patch(r.key, { cardNumber: e.target.value.trim() })} /></td>
                  <td className="p-1.5"><input className="w-14 rounded border border-transparent bg-transparent px-1 hover:border-line" inputMode="numeric" aria-label={`Quantity for ${r.source}`} defaultValue={r.qty}
                    onBlur={(e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1) patch(r.key, { qty: n }); else e.target.value = String(r.qty) }} /></td>
                  <td className="p-1.5 text-right"><input className="w-24 rounded border border-transparent bg-transparent px-1 text-right hover:border-line" inputMode="decimal" aria-label={`Market price for ${r.source}`} defaultValue={r.marketCents === null ? '' : (r.marketCents / 100).toFixed(2)}
                    onBlur={(e) => { const c = parseMoney(e.target.value); if (c !== null && c >= 0) patch(r.key, { marketCents: c, blocking: r.blocking.filter((b) => !b.startsWith('No usable') && !b.startsWith('No market') && !b.startsWith('Could not read')) }); else e.target.value = r.marketCents === null ? '' : (r.marketCents / 100).toFixed(2) }} /></td>
                  <td className="p-1.5 text-right">{sticker === null ? '—' : formatAud(sticker)}{r.stickerOverrideCents !== null && '*'}</td>
                  <td className="p-1.5 text-xs">
                    <span className="opacity-60">{r.source}</span>
                    {r.blocking.map((b) => <div key={b} className="text-red-500">{b}</div>)}
                    {r.notes.map((n) => <div key={n} className="text-accent-ink">{n}</div>)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs opacity-70">Stock is added as opening stock with no cost recorded. Untick anything you don't want. Edit names, numbers, quantities and prices here before importing.</p>
      <div className="mt-3 flex justify-between">
        <button className={ghostBtn} onClick={() => setRows(null)}>Back</button>
        <div className="flex gap-2">
          <button className={ghostBtn} onClick={onClose}>Cancel</button>
          <button className={btnCls} disabled={total === 0} onClick={runImport}>Import {total} items</button>
        </div>
      </div>
    </Modal>
  )
}
