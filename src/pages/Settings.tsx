import { updateSettings } from '../data/changes'
import { DEFAULT_SETTINGS, settingsFor } from '../data/derive'
import { useChangeCtx, useStore } from '../data/store'
import type { ProfileId } from '../data/types'
import { stickerFromMarket, type StickerRounding } from '../domain/sticker'
import { formatAud } from '../domain/money'
import { csvCell, toCsv } from '../domain/report'
import { DEFAULT_NAMES, PROFILE_IDS } from '../lib/profile'
import { toggleTheme } from '../lib/theme'
import { ghostBtn, inputCls } from '../ui/common'
import { downloadText } from '../ui/format'

const ROUNDING: [StickerRounding, string][] = [['none', 'Exact to the cent'], ['50c', 'Nearest 50c'], ['1', 'Nearest $1'], ['5', 'Nearest $5']]

function ProfileSettings({ p }: { p: ProfileId }) {
  const { raw, apply, notify } = useStore()
  const ctx = useChangeCtx()
  const doc = raw.profiles.find((x) => x.id === p) ?? { id: p }
  const s = settingsFor(raw.profiles, p)
  const save = (patch: NonNullable<typeof doc.settings>) => {
    try { apply(updateSettings(ctx(), doc, patch)) } catch (e) { notify((e as Error).message, true) }
  }
  const example = stickerFromMarket(3500, s.multiplierPermille, s.rounding)
  return (
    <section className="rounded-2xl border border-line bg-surface shadow-card p-4" aria-label={`${DEFAULT_NAMES[p]} settings`}>
      <h2 className="mb-3 font-semibold">{DEFAULT_NAMES[p]}'s pricing</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs font-medium">Sticker = market ×
          <input className={inputCls} aria-label={`${DEFAULT_NAMES[p]} sticker multiplier`} inputMode="decimal" defaultValue={(s.multiplierPermille / 1000).toFixed(2)} key={s.multiplierPermille}
            onBlur={(e) => { const n = Number(e.target.value); if (!Number.isFinite(n)) return notify('Enter a number like 1.10', true); const pm = Math.round(n * 1000); if (pm !== s.multiplierPermille) save({ multiplierPermille: pm }) }} />
        </label>
        <label className="text-xs font-medium">Round stickers to
          <select className={inputCls} aria-label={`${DEFAULT_NAMES[p]} sticker rounding`} value={s.rounding} onChange={(e) => save({ rounding: e.target.value as StickerRounding })}>
            {ROUNDING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium">Price is stale after (days)
          <input className={inputCls} inputMode="numeric" defaultValue={s.stalePriceDays} key={s.stalePriceDays}
            onBlur={(e) => { const n = Number(e.target.value); if (!Number.isInteger(n) || n < 1) return notify('Use a whole number of days', true); if (n !== s.stalePriceDays) save({ stalePriceDays: n }) }} />
        </label>
        <label className="text-xs font-medium">Re-sticker when the price moves more than (%)
          <input className={inputCls} inputMode="numeric" defaultValue={s.restickerPct} key={s.restickerPct}
            onBlur={(e) => { const n = Number(e.target.value); if (!Number.isFinite(n) || n < 0 || n > 100) return notify('Use a percentage from 0 to 100', true); if (n !== s.restickerPct) save({ restickerPct: n }) }} />
        </label>
        <p className="self-end text-sm opacity-80">Example: market $35.00 → sticker <strong>{formatAud(example)}</strong></p>
      </div>
    </section>
  )
}

export function SettingsPage() {
  const { raw, rows } = useStore()

  const exportInventory = () =>
    downloadText(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([
      ['Owner', 'Name', 'Type', 'Game', 'Set', 'Number', 'Language', 'Variant', 'Condition', 'Grader', 'Grade', 'Qty', 'Market each (AUD)', 'Sticker each (AUD)', 'Known cost (AUD)', 'Location', 'Notes'],
      ...rows.map((r) => [DEFAULT_NAMES[r.item.profileId], r.item.name, r.item.kind, r.item.game, r.item.setName, r.item.cardNumber, r.item.language, r.item.variant, r.item.condition,
        r.item.gradingCompany, r.item.grade, r.qty, (r.item.marketPriceCents / 100).toFixed(2), (r.sticker / 100).toFixed(2), (r.knownCostCents / 100).toFixed(2), r.item.location, r.item.notes]),
    ]))

  const exportAll = () =>
    downloadText(`damudkipspot-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), ...raw }, null, 2), 'application/json')

  return (
    <main className="min-h-0 min-w-0 flex-1 overflow-auto p-5 md:p-7">
      <h1 className="mb-3 text-xl font-semibold">Settings</h1>
      <div className="mb-6 grid max-w-3xl gap-4 md:grid-cols-2">
        {PROFILE_IDS.map((p) => <ProfileSettings key={p} p={p} />)}
      </div>
      <p className="mb-6 max-w-3xl text-xs opacity-70">Default is market × {(DEFAULT_SETTINGS.multiplierPermille / 1000).toFixed(2)}, rounded to the nearest $1. A manual sticker on an item always wins over these.</p>

      <section className="mb-6 max-w-3xl rounded-2xl border border-line bg-surface shadow-card p-4" aria-label="Backup">
        <h2 className="mb-1 font-semibold">Back up your data</h2>
        <p className="mb-3 text-sm opacity-80">Firebase keeps your data, but a copy of your own is a good idea, especially before tax time.</p>
        <div className="flex gap-2">
          <button className={ghostBtn} onClick={exportInventory}>Download stock list (CSV)</button>
          <button className={ghostBtn} onClick={exportAll}>Download everything (JSON)</button>
        </div>
        <p className="mt-2 text-xs opacity-60">{csvCell(`${raw.items.length} items, ${raw.lots.length} lots, ${raw.sales.length} sales, ${raw.shows.length} shows`)}</p>
      </section>

      <section className="max-w-3xl rounded-2xl border border-line bg-surface shadow-card p-4" aria-label="Appearance">
        <h2 className="mb-2 font-semibold">Appearance</h2>
        <button className={ghostBtn} onClick={toggleTheme}>Switch light / dark</button>
      </section>
    </main>
  )
}
