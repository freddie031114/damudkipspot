# Card show inventory tracker

Shared inventory, sales and show tracker for two trading card vendors in Australia. Desktop-first web app used on a laptop at the table and at home. Mainly Pokémon TCG singles and sealed product (including Simplified Chinese), but nothing in the model is Pokémon-specific.

**Status: plan agreed, no code written yet.** Build in the order given under "Build order". Update this file when a decision changes.

## Agreed decisions

| Topic | Decision |
|---|---|
| Users | Exactly two people, each with their own login and profile. Signups disabled; the `profiles` table is the allowlist. |
| Cross-profile access | **Always editable.** Either person can view and edit either profile's inventory, sales and prices. No read-only mode, no per-profile toggle. |
| Attribution | Every row and audit entry records the authenticated actor. Sales also record who sold it and whose stock it was. |
| Selling each other's stock | Allowed any time (follows from "always editable"). Stock and revenue belong to the item's owner; the sale records the seller. |
| Combined view | Read-only merged view of both inventories (total stock, total value). Editing happens in a single-profile view. |
| Pricing | **All prices entered manually, in AUD.** No pokemontcg.io, no FX conversion in v1. |
| Sticker price | Sticker (asking) price = market price × 1.10. The multiplier is a setting per profile. |
| Cost basis | **Purchase lots, FIFO.** Each purchase is a lot with its own unit cost and date; sales consume the oldest lot first. |
| Auth | Email + password. Magic links need email access on show wifi, so they are not used. |
| Money | Integer cents everywhere, AUD only. No floats. |
| Deletes | Soft delete only (`deleted_at`). No hard deletes through the API. |

### Confirmed assumptions

1. **Sticker override.** Sticker is computed from market by default, but an item can carry an optional manual sticker override (for bulk bins, bundles, showcase cards). Clearing the override returns to 1.1×.
2. **Sticker rounding.** Default is **nearest $1** (confirmed; it matches the existing sheet). Per-profile setting: none / nearest 50c / nearest $1 / nearest $5.
3. **Trades.** A trade is a payment method with a trade credit value; optionally the cards received are entered as new lots whose cost is the credit given.
4. **GST.** Not modelled. Reports give revenue, cost and profit; add GST handling only if either person registers.
5. **Shared-cost split.** Table fee and other show expenses split equally by default, with a custom percentage option per expense.

## Tech stack

- **App:** React + Vite + TypeScript (strict). Tailwind + shadcn/ui (Radix) for components and dark mode.
- **Tables:** TanStack Table + TanStack Virtual. All filtering, sorting and search run in memory against the local store.
- **Local store:** Dexie (IndexedDB) with `useLiveQuery`. The UI reads only from Dexie, never directly from the network.
- **Backend:** Supabase (Auth, Postgres, RLS, Storage, Realtime). Hosted on Vercel as a static SPA.
- **Offline shell:** `vite-plugin-pwa` service worker so the app loads with no connection. Without it a page reload at a show would break the app.
- **Other:** Zod (validation), PapaParse (CSV), Recharts (charts), cmdk (command palette).
- **Tests:** Vitest + Testing Library + `fake-indexeddb` for unit and sync tests; SQL and RLS tests against Postgres; Playwright for the sale flow end to end.

### Why this differs from the original brief

- **Local-first instead of "queue writes when offline".** Reading from the network and only queueing writes gives two code paths and a slow table. Reading always from IndexedDB gives instant search and makes offline the normal path, not a special case.
- **Stock is derived, not a mutable number.** Quantity = sum of remaining lot quantities, changed only by appended events (lot added, sale, adjustment, void). Two laptops selling the same card offline both succeed and both count, which a last-write-wins quantity field cannot do.
- **The price-provider module shrinks** to an interface with one `ManualProvider`, because all prices are manual. The interface stays so a real provider can be added later.

## Architecture

```
React UI  ──reads──▶  Dexie (IndexedDB)  ◀──pull (changed rows)──  Supabase Postgres
    │                      ▲                                            ▲
    └──mutation──▶ apply locally + append to outbox ──push (RPC)────────┘
```

### Writes

- Every mutation is an **op**: `{ op_id (uuid), type, payload, actor, created_at }`. It is applied to Dexie immediately and appended to an `outbox` table in the same Dexie transaction.
- The sync loop pushes ops in order through a single Postgres RPC, `apply_ops(ops jsonb)`. Each op runs in its own savepoint.
- **Idempotency:** the server records each `op_id` in `applied_ops`. A replayed op returns the stored result and changes nothing.
- All row IDs are client-generated UUIDs, so creates are safe to retry.
- A rejected op (validation failure) is moved to a visible "sync problems" list with a retry/discard choice. It is never silently dropped.

Op types: `item.create`, `item.update`, `item.delete`, `item.restore`, `lot.add`, `lot.update`, `lot.delete`, `stock.adjust`, `sale.create`, `sale.void`, `show.*`, `expense.*`, `view.*`, `settings.update`.

### Reads and sync

- Pull per table: rows where `updated_at >= cursor − 30s`, upserted into Dexie. The overlap makes missed rows from concurrent transactions harmless because upserts are idempotent.
- Supabase Realtime is used only as a nudge to pull sooner. Correctness never depends on it.
- Triggers: on app start, on `online` event, after each push, on Realtime nudge, every 60s while online.
- A status pill always shows: online/offline, number of queued ops, last synced time.

### Conflict handling

| Case | Rule |
|---|---|
| Both edit different fields of one item | Both kept. `item.update` carries only changed fields. |
| Both edit the same field | Last to reach the server wins. The audit log keeps the overwritten value. |
| Both sell the same item offline | Both sales recorded. Server allocates lots FIFO in arrival order. |
| Sales exceed stock | Sale still recorded (the card physically left the table). Unallocated quantity is flagged "oversold, needs review" with unknown cost. |
| Edit to an item the other person deleted | Edit applies, item stays deleted, restorable from Trash. |
| Sale voided twice | Second void is a no-op. |

**FIFO allocation is done by the server** inside `apply_ops`, in one transaction, writing `lot_allocations`. The client computes a provisional allocation for display and replaces it with the server's result after sync. This is the only place client and server can briefly disagree, and it only affects displayed cost, never stock counts or revenue.

### Auth and offline

- The Supabase session persists locally; the app boots from the service worker cache and Dexie without network.
- If the token expires offline, the app keeps working and queues ops; it re-authenticates when back online.
- Logging out with queued ops is blocked behind an explicit warning, because logging back in needs network.
- **One shared laptop at a table:** Show mode has a "selling as" switch so the second person does not need to log in. The sale records `sold_by` (selected) and the audit log records the authenticated actor.

## Data model

All tables have `id uuid`, `created_at`, `updated_at`, `created_by`, `updated_by`. `created_by`/`updated_by`/`updated_at` are set by triggers from `auth.uid()` and cannot be supplied by the client.

**profiles** — `user_id` (auth.users), `display_name`, `colour`, `settings jsonb` (sticker multiplier, sticker rounding, low-stock threshold, stale-price days, re-sticker threshold %).

**items** — `profile_id` (owner), `kind` (single / sealed / graded / bulk / other; a `bulk` item is a lump-sum pool such as "bulk commons" with a manual value and no sticker), `game`, `name`, `set_name`, `set_code`, `card_number`, `language` (EN, JA, zh-CN, zh-TW, …), `variant` (finish), `condition` (null for sealed), `grading_company`, `grade`, `sealed_type` (booster box, case, ETB, pack, …), `market_price_cents`, `market_price_updated_at`, `sticker_override_cents` (nullable), `stickered_price_cents` (price on the physical sticker), `location`, `notes`, `tags text[]`, `photo_path`, `low_stock_threshold`, `import_batch_id`, `deleted_at`.
- Sticker price is computed: `sticker_override_cents ?? round(market_price_cents × multiplier)`. One shared function in the client and one in SQL, tested against each other.
- Quantity is not stored on the item. It is `sum(lots.qty_remaining)`.

**lots** — `item_id`, `profile_id`, `acquired_at`, `qty_acquired`, `qty_remaining` (server-maintained), `unit_cost_cents` (**nullable**: opening-stock lots from the spreadsheet have no recorded cost; editing a lot's cost later updates the cost of goods sold on sales that consumed it), `source` (purchase / trade-in / import / opening), `note`, `import_batch_id`, `deleted_at`.

**sales** — `sold_by_profile_id`, `show_id` (nullable), `sold_at`, `note`, `discount_cents`, `voided_at`, `voided_by`.

**sale_lines** — `sale_id`, `item_id`, `owner_profile_id`, `qty`, `sticker_price_cents` (at time of sale), `unit_price_cents` (actual), `line_total_cents`. A sale can contain items from both profiles.

**sale_payments** — `sale_id`, `method` (cash / card / PayID / trade), `amount_cents`, `received_by_profile_id`. Supports split payments.

**lot_allocations** — `lot_id`, `sale_line_id` or `adjustment_id`, `qty`, `unit_cost_cents`. Source of truth for cost of goods sold.

**adjustments** — `item_id`, `qty_delta`, `reason` (damaged / lost / kept for collection / count correction / found), `note`. Negative adjustments consume lots FIFO.

**price_history** — `item_id`, `market_price_cents`, `recorded_at`, `recorded_by`, `source`. Written by trigger whenever market price changes.

**shows** — `name`, `starts_on`, `ends_on`, `venue`, `table_fee_cents`, `status` (planned / live / closed), `notes`. **show_participants** — `show_id`, `profile_id`, `opening_float_cents`, `closing_cash_cents`. **show_expenses** — `show_id`, `description`, `amount_cents`, `paid_by_profile_id`, `split` (equal / custom), `split_pct jsonb`.

**saved_views** — `profile_id`, `name`, `screen`, `config jsonb` (columns, filters, sort).

**import_batches** — `profile_id`, `filename`, `mapping jsonb`, `row_count`, `undone_at`.

**audit_log** — `at`, `actor_profile_id`, `target_profile_id`, `entity`, `entity_id`, `action`, `diff jsonb` (before/after of changed fields), `op_id`, `show_id`. Written only by triggers.

**applied_ops** — `op_id` (pk), `actor`, `applied_at`, `result jsonb`.

### Row-level security

- `is_member()` = the caller has a row in `profiles`.
- Data tables: members can select, insert and update rows of either profile. No delete policy on any table.
- `audit_log`, `price_history`, `lot_allocations`, `applied_ops`: select only for members; written by triggers and security-definer functions.
- `profiles`: members read both; each user updates only their own row.
- Non-members and anonymous callers: nothing.
- Storage bucket for photos: private, members only.

## Screens

1. **Login.**
2. **Inventory** (home). Virtualised dense table, inline cell editing, column sort/filter/show/hide, multi-select with bulk edit/delete/move location, saved views, profile switcher (Mine / Theirs / Combined). Flags column: low stock, stale price, needs re-sticker, oversold.
3. **Item drawer.** All fields, lots (add / edit / remaining), price history chart, sales of this item, audit trail, photo.
4. **Quick add.** Modal with type-ahead from existing items (same card → add a lot instead of a duplicate row). Enter to save and add another.
5. **Quick sell.** Search → item → price pre-filled from sticker → payment method → Enter. Can add more lines for a bundle, apply a bundle discount, split payment. Toast with Undo.
6. **Reprice mode.** Steps through items with the oldest market prices; type a price, Enter moves to the next. Needed because all pricing is manual.
7. **Import wizard.** Upload CSV → pick preset (Collectr / generic) → map columns → preview with validation and duplicate matching → import. Each import can be undone as a whole.
8. **Shows.** List and detail: fee, expenses, participants, float.
9. **Show mode.** Full-screen: large search bar, quick sell, running takings (total and per payment method, per profile), recent sales with undo, "selling as" switch, sync status.
10. **Show summary.** Sales, revenue, cost and profit per profile; expense split; cash reconciliation (float + cash sales vs counted); settlement showing who owes whom, including money one person collected for the other's stock.
11. **Dashboard** (per profile and combined). Market value, cost, unrealised profit, top movers, low stock, recent sales, stale prices, sell-through.
12. **Reports.** Sales log filterable by profile / show / date range / payment method; profit per card; Australian financial year presets (1 July – 30 June); CSV export.
13. **Audit log.** Filterable by actor, profile, entity, date.
14. **Trash.** Soft-deleted items, lots and voided sales with restore.
15. **Settings.** Profile, sticker multiplier and rounding, thresholds, theme, data export.
16. **Shortcut cheat sheet** (`?`) and **command palette** (`Ctrl+K`).

### Keyboard shortcuts

`/` search · `N` add item · `S` quick sell · `Ctrl+Z` undo · `Ctrl+K` command palette · `?` cheat sheet · `G I` / `G D` / `G S` / `G R` go to inventory / dashboard / shows / reports · `1` `2` `3` switch profile view · arrows + `Enter` to move and edit cells · `Esc` cancel · `X` select row · `Del` delete selected. Single-key shortcuts are disabled while a text field has focus.

### Undo

- Session undo stack of inverse ops (`Ctrl+Z`) for edits, adds, deletes and sales.
- A sale is undone by `sale.void`, which restores lot quantities. The sale row is kept.
- Anything older is recoverable from Trash or the audit log.

## Extras included beyond the brief

- Graded cards (company + grade) and sealed types as first-class fields.
- Multi-item sales with bundle discount and split payments.
- Sticker price captured on each sale, so reports show discount given versus sticker.
- "Needs re-sticker" flag: the physical sticker differs from the current computed sticker by more than the threshold. This replaces the "drift from asking price" flag, which has no meaning once asking price is derived from market.
- Stale-price flag and Reprice mode.
- Stock adjustments with reasons (damaged, lost, kept, count correction).
- Cash float and end-of-show cash reconciliation; settlement between the two profiles.
- Undo for a whole CSV import.
- Full data export (all tables to CSV/JSON) as a manual backup.
- Tags and locations with bulk move.

### Deliberately left for later

Card metadata autocomplete from an external database, automatic price providers, printable price labels, barcode/camera scanning, a buylist calculator (offer X% of market), mobile layout, GST.

## Existing inventory (Google Sheet "Inventory")

Read on 2026-11-10. Layout: two side-by-side blocks. **Left (columns A–E) is the friend's; right (columns F–J) is the owner's.**

Answers from the owner (resolved):
- **Slab price is the market price.** Sticker is computed as market × 1.1, rounded like everything else. The friend's block is the only one with slabs (15 rows, $15,470).
- **Lucario SWSH 291:** quantity 8, market $32 each ($256 total), sticker $35 each. The "35 each" in the name is the sticker price, which matches 32 × 1.1 rounded.
- **"Sealed" means a sealed promo** (a single still in its sealed promo pack). Import as `kind = single` with variant "Sealed promo". Not a sealed-product item.
- **No purchase costs exist.** All opening lots import with null cost. Profit reports show opening-stock sales as revenue with "cost unknown" and keep them out of profit totals, so profit is never overstated. Costs can be added later per lot or in bulk, and reports then update.

Original findings: about 48 rows in the left block, 52 in the right. Each has Cards / Market / Sticker, a Total, a Bulk figure and a Slabs total. About 48 rows in the left block, 52 in the right, plus 15 slabs in the left block.

What this tells us:
- **Sticker is already ~1.1 × market, rounded to the nearest $1** in the left block. The right block sometimes rounds up to $5 (Arbok $35 → $40, Steelix $35 → $40, Charizard 094/080 $40 → $45), which the manual sticker override and the $5 rounding option cover.
- **"Bulk" is a dollar value, not a count** (left $1,750, right $1,254). The grand total is cards total + bulk, then slabs on top. So bulk needs to be a first-class lump-sum item (`kind = bulk`), and the dashboard totals must include it.
- **Slabs have one price column**, not market and sticker. Import it as the market price with sticker computed, unless you tell us the slab price is already the asking price.
- **No quantities, costs, conditions or languages.** Name, set number and variant are in one string ("Gengar TG06/TG30 LP", "Dialga PSA10 Origin"). Quantity appears once ("lucario SWSH 291 *8 35 each" = 8 at $35, entered as $256, which is not 8 × $35). Opening lots import with unknown cost.
- **Other TCGs are already in there** (One Piece style names such as Whitebeard 005 and Kaido 062; "loki -119" is unidentified), confirming the multi-game model.
- **Dirty data:** `30$` instead of `$30`, inconsistent case, typos (suicine, gyrados, Braxien), duplicate rows (Gold Star Greninja twice, Gengar TG06/TG30 twice, one marked LP), a Japanese slab ("Shaymin JP"), a CGC-style slab ("CCIC 10 GLACEON"), and ambiguous "(sealed)" tags on single cards.

Migration approach:
1. One-off importer built on the Phase 6 wizard, with a "Google Sheet block" preset: parse price strings, split name / number / variant / condition / grading where it can, flag the rest.
2. Everything lands in a review table before import. Rows with problems (unparseable price, possible duplicate, quantity in the name, unclear "sealed") are highlighted and must be resolved or accepted.
3. Imported as `source = opening` lots with null cost; the whole batch is undoable.
4. After import the dashboard totals must equal the sheet's totals (cards + bulk, and slabs). Treat any mismatch as a failed migration.

## Backend choice (Supabase vs Firebase)

Decision stays **Supabase** unless the owner says otherwise. Firebase is workable, but Firestore has no joins or SQL, so the sales, lots and profit reports and the audit trail would be rebuilt as application code, and server-side triggers need Cloud Functions on the paid plan. Postgres RLS also lets us test the permission rules directly. Firebase's real advantage is built-in offline persistence and no free-tier pausing. If we switch, the sync engine is simplified and FIFO cost is computed at read time from lots and sale lines.

## Build order

Each phase ends with passing tests and a working app.

0. **Scaffold.** Vite + React + TS, Tailwind, shadcn/ui, routing, dark mode, lint, Vitest, CI, Vercel config, `.env.example`.
1. **Database.** Migrations for all tables, triggers (actor stamping, audit, price history), RLS policies, `apply_ops` with idempotency and FIFO allocation. **Tests: permission rules, FIFO, idempotency.**
2. **Sync engine.** Dexie schema, op definitions with local apply functions, outbox, push/pull loop, status pill, sync problems list. **Tests: offline queue, replay, conflict cases in the table above.**
3. **Auth and shell.** Login, session persistence, profile switcher, PWA service worker.
4. **Inventory.** Table, inline edit, quick add, lots, bulk actions, soft delete, Trash, undo stack, item drawer, audit log screen.
5. **Sales.** Quick sell, multi-line, payments, void/undo. **Tests: sale flow unit + Playwright end to end.**
6. **Import.** Wizard, Collectr preset, generic mapping, duplicate matching, import undo. Plus the one-off migration of the existing Google Sheet (see "Existing inventory" below).
7. **Pricing.** Sticker computation and override, price history chart, Reprice mode, stale and re-sticker flags.
8. **Shows.** CRUD, Show mode, expenses, float, summary and settlement.
9. **Dashboard and reports.** Metrics, sales log, profit per card, CSV export.
10. **Polish.** Saved views, command palette, cheat sheet, Combined view, photos, full export, narrow-screen check, performance pass with 10,000 seeded items.

## Risks

| Risk | Mitigation |
|---|---|
| Sync bugs lose or duplicate data | Op log with idempotent server apply; append-only stock events; sync tests written before UI; outbox never cleared until the server acknowledges. |
| App will not load offline after a reload | Service worker precaches the shell; tested with network disabled in Playwright. |
| Browser clears IndexedDB while ops are queued | Request persistent storage (`navigator.storage.persist()`); warn when the queue is non-empty and the tab is closing; never use private browsing at a show. |
| Supabase free tier pauses after a week of inactivity and has no point-in-time recovery | Scheduled keep-alive ping and a scheduled database dump via GitHub Actions, or the paid tier. In-app full export as a second backup. |
| Client and server FIFO disagree | Server is the authority; client result is provisional and replaced on sync. |
| Sticker price computed differently in TS and SQL | Shared test vectors run against both implementations. |
| Collectr export format differs from what the preset expects, or its prices are in USD | Build the preset from a real export file; the mapping step always allows manual correction; imported market prices are flagged for review. |
| FIFO lots make data entry slower | Quick add creates the item and first lot in one step; lots only surface in the item drawer. |
| "Always editable" means a mistake can change the other person's data | Every change is in the audit log with before/after values; soft deletes; undo. |
| RLS tests need a real Postgres | Run SQL tests against local Supabase in CI; the app must not ship if they are skipped. |

## Needed from the owner before or during the build

- A Supabase project (URL, anon key, and a service-role key for migrations and CI only) and a Vercel project.
- The two login emails and display names.
- A real Collectr CSV export to build and test the import preset against.

## Conventions

- Money is integer cents; format with `Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })`.
- Dates stored as UTC `timestamptz`; displayed in the browser's timezone. Financial year = 1 July to 30 June.
- No component reads from Supabase directly. Reads go through Dexie; writes go through ops.
- Every new op type needs: a Zod schema, a local apply function, a server handler in `apply_ops`, an inverse for undo, and tests for all four.
- Schema changes are new migration files; never edit an applied migration.
