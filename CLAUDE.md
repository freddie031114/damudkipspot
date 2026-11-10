# Card show inventory tracker

Shared inventory, sales and show tracker for two trading card vendors in Australia. Desktop-first web app used on a laptop at the table and at home. Mainly Pokémon TCG singles and sealed product (including Simplified Chinese), but nothing in the model is Pokémon-specific.

**Status: feature-complete first version built and deployed (see Progress). Backend is Firebase (owner's choice). Needs a real sign-in test.** Update this file when a decision changes.

## Agreed decisions

| Topic | Decision |
|---|---|
| Users | Two people use the app, each as their own profile (`p1` owner, `p2` friend), chosen in-app. Sign-in is **Google** (open to any account), but data access is limited to an approved email list in `firestore.rules`. |
| Cross-profile access | **Always editable.** Either person can view and edit either profile's inventory, sales and prices. No read-only mode, no per-profile toggle. |
| Attribution | Every row and audit entry records the acting profile chosen in the app (not tamper-proof, since the login is shared). Sales also record who sold it and whose stock it was. |
| Selling each other's stock | Allowed any time (follows from "always editable"). Stock and revenue belong to the item's owner; the sale records the seller. |
| Combined view | Back at the owner's request (it was removed once, then restored). The sidebar has Freddie / Ferrell / Combined (keys `1` `2` `3`). Combined merges both people's stock with an owner tag on each row, and rows stay editable like everything else. Quick add in Combined puts new stock under the acting profile. Dashboard and Reprice follow the same switch. |
| Expenses | A dedicated Expenses page tracks every cost the two split (table fees, travel, food, supplies, postage). Show costs and general costs live in the same `showExpenses` collection; `showId` is null for costs outside a show. Each cost records who paid and the split (equal by default, custom % optional). The page shows who owes whom on unsettled costs; "Settle up" marks them settled. |
| Names | Profile `p1` is **Freddie** (the owner), `p2` is **Ferrell** (the friend). The site is branded **damudkipspot** with a Mudkip theme. |
| Pricing | **All prices entered manually, in AUD.** No pokemontcg.io, no FX conversion in v1. |
| Sticker price | Sticker (asking) price = market price × 1.10. The multiplier is a setting per profile. |
| Cost basis | **Purchase lots, FIFO.** Each purchase is a lot with its own unit cost and date; sales consume the oldest lot first. |
| Auth / backend | Firebase Auth with Google sign-in, Cloud Firestore, free Spark plan, no Cloud Functions. Hosted on Vercel. |
| Trades | Customers can pay partly or wholly in cards. Quick sell and Show mode have a Trade-in section; cards received become stock costed at the credit given. See assumption 3. |
| Location | **Removed** at the owner's request. Items have no location field or column. |
| Layouts | **Two layouts.** Desktop (768px and wider) keeps the sidebar, top bar and wide table. Phones (under 768px) get their own layout, chosen in code by `useIsMobile()` (`src/lib/useMedia.ts`): a slim top bar with a Freddie / Ferrell / Both switch, a bottom tab bar (Stock, Shows, Sell, Costs, More), the inventory as a searchable card list, dialogs as bottom sheets, and Show mode with a "Review sale" bar that opens the current sale as a sheet. Both layouts read the same data and write through the same helpers, so nothing differs in behaviour. It switches live when the window is resized or the phone rotated. |
| Money | Integer cents everywhere, AUD only. No floats. |
| Deletes | Soft delete only (`deleted_at`). No hard deletes through the API. |

### Confirmed assumptions

1. **Sticker override.** Sticker is computed from market by default, but an item can carry an optional manual sticker override (for bulk bins, bundles, showcase cards). Clearing the override returns to 1.1×.
2. **Sticker rounding.** Default is **nearest $1** (confirmed; it matches the existing sheet). Per-profile setting: none / nearest 50c / nearest $1 / nearest $5.
3. **Trades.** A trade is a sale where the customer hands over cards as part of the payment. Each card received (`tradeIns[]` on the sale) becomes stock in the same write: a new item if it is not already held, plus a `trade-in` lot costed at the credit given. The credit counts as a `trade` payment, the balance is paid by cash / card / PayID, and if the cards are worth more than the sale the difference is handed back as a negative cash payment. The new stock goes to whoever owns the stock being sold unless chosen otherwise; if it goes to the other person, settlement accounts for it. Voiding a trade takes the cards back out of stock.
4. **GST.** Not modelled. Reports give revenue, cost and profit; add GST handling only if either person registers.
5. **Shared-cost split.** Table fee and other show expenses split equally by default, with a custom percentage option per expense.

## Tech stack

- **App:** React + Vite + TypeScript (strict). Tailwind CSS for styling and dark mode; Radix primitives where needed.
- **Tables:** TanStack Table + TanStack Virtual. Filtering, sorting and search run in memory over the live Firestore data.
- **Backend:** **Firebase** on the free Spark plan: Authentication (email + password), Cloud Firestore, Storage (photos, later). **No Cloud Functions** (they need the paid plan), so all logic runs in the client and Firestore security rules.
- **Hosting:** Vercel, static SPA with a rewrite to `index.html`. Firebase is only used as the backend.
- **Offline:** Firestore's built-in persistent cache (`persistentLocalCache` + multi-tab manager) holds a local copy and queues writes while offline, replaying them on reconnect. Plus `vite-plugin-pwa` so the app shell loads with no connection.
- **Other:** Zod (validation), PapaParse (CSV), Recharts (charts), cmdk (command palette).
- **Tests:** Vitest for the pure domain logic (money, sticker, FIFO, stock, sale, CSV parsing). Firestore security rules tested against the Firebase emulator (needs Java) in CI.

### Why this differs from the original brief

- **One shared login, two profiles.** Both people sign in as `damudkipspot@gmail.com`; there is no per-user identity in Firebase. Profile ("Me" / "Friend") is an in-app switch remembered on that device. Attribution (who sold it, who edited it) is therefore the acting profile chosen in the app, which is honest bookkeeping, not tamper-proof security. Cross-profile permission rules from the original brief do not exist: everything is editable by both.
- **Stock is derived, not a stored number.** Quantity = lots received − sales − adjustments, computed from append-only records. Two laptops selling the same card offline both record a sale and nothing is overwritten. This replaces the custom sync engine and `apply_ops` design.
- **FIFO cost is computed at read time** from lots and sales (a pure function), not written by a server. With no server, there is no allocation step that can drift.
- **The price-provider module shrinks** to an interface with one `ManualProvider`, since all prices are manual.

## Architecture

```
React UI ◀── onSnapshot (live queries) ── Firestore local cache (IndexedDB) ◀──sync──▶ Firestore
   │                                              ▲
   └── writeBatch (change + audit entry) ─────────┘   (queued automatically when offline)
```

- **Reads:** the app subscribes to each collection once (`onSnapshot`) and keeps the results in an in-memory store. Components read the store, never Firestore directly. Thousands of items filter instantly in memory.
- **Writes:** every change is one `writeBatch` that contains the data change **and** its `auditLog` entry, so they succeed or fail together, online or offline. IDs are generated on the client (`crypto.randomUUID()`), so retries are safe.
- **Sales are one document**, with `lines[]` and `payments[]` embedded, so a sale can never be half-saved. A sale is never edited; undoing sets `voidedAt`.
- **Deletes are soft** (`deletedAt`). Rules forbid hard deletes on every collection.
- **Status pill:** shows online/offline and whether writes are still pending (`hasPendingWrites`, `waitForPendingWrites`).
- **Offline login:** Firebase Auth persists the session locally; the app opens and works offline. Signing out while writes are pending is blocked behind a warning.
- **Shared laptop:** Show mode has a "selling as" switch. The sale records `soldByProfileId`.

### Conflict handling

| Case | Rule |
|---|---|
| Both edit different fields of one item | Both kept. Updates write only changed fields. |
| Both edit the same field | Last write to reach Firestore wins. The audit log keeps before/after values. |
| Both sell the same item offline | Both sales recorded; stock is derived so nothing is lost. |
| Sales exceed stock | Sale stays recorded (the card physically left). Item shows "oversold, needs review", unallocated quantity has unknown cost. |
| Edit to an item the other person deleted | Edit applies, item stays deleted, restorable from Trash. |
| Sale voided twice | Voiding an already-voided sale is a no-op. |

### FIFO and stock (pure functions in `src/domain`)

- Supply per item: lots (ordered by `acquiredAt`, then `createdAt`), plus positive adjustments as cost-unknown lots.
- Demand per item: non-voided sale lines and negative adjustments, ordered by time (`soldAt` / `createdAt`).
- Demand consumes the oldest remaining supply first. Allocation ignores whether a lot was entered after the sale, which keeps results deterministic when devices sync late.
- Output: on-hand quantity, remaining value at cost, cost of goods sold per sale line, unallocated (oversold) quantity, and a "cost unknown" flag when any consumed supply has null cost.

### Firestore cost awareness (free tier: 50k reads, 20k writes per day)

- Live listeners resume from the local cache, so only changed documents count as reads after the first load.
- Avoid repeated full re-reads: no polling, no "refresh all" button that re-queries.
- Keep `priceHistory` and `auditLog` out of the always-on subscriptions; load them per item or per screen with limits.
- Bulk imports use batches of at most 400 writes.

## Data model (Firestore collections)

Every document has `id`, `createdAt`, `updatedAt`, `createdBy` and `updatedBy` (acting profile id). Money is integer cents. Profile ids are `p1` (owner, the right-hand block of the old sheet) and `p2` (friend, the left-hand block). Display names are editable in Settings.

- **profiles/{p1|p2}**: `displayName`, `colour`, `settings` (sticker multiplier, sticker rounding, low-stock threshold, stale-price days, re-sticker threshold %).
- **items**: `profileId`, `kind` (single / sealed / graded / bulk / other; `bulk` is a lump-sum pool with a manual value and no sticker), `game`, `name`, `setName`, `setCode`, `cardNumber`, `language`, `variant`, `condition`, `gradingCompany`, `grade`, `sealedType`, `marketPriceCents`, `marketPriceUpdatedAt`, `stickerOverrideCents` (nullable), `stickeredPriceCents` (price on the physical sticker), `notes`, `tags`, `photoPath`, `lowStockThreshold`, `importBatchId`, `deletedAt`.
  - Sticker price = `stickerOverrideCents ?? round(marketPriceCents × multiplier)` using the profile's rounding rule.
  - Quantity is not stored on the item.
- **lots**: `itemId`, `profileId`, `acquiredAt`, `qty`, `unitCostCents` (**nullable**, as opening stock has no recorded cost), `source` (purchase / trade-in / import / opening), `note`, `saleId` (trade-ins only), `importBatchId`, `deletedAt`.
- **sales**: `soldByProfileId`, `showId`, `soldAt`, `note`, `discountCents`, `lines[]` (`itemId`, `ownerProfileId`, `qty`, `stickerPriceCents`, `unitPriceCents`), `payments[]` (`method`: cash / card / payid / trade, `amountCents`, `receivedByProfileId`; a negative cash amount is change handed back after a trade), `tradeIns[]` (`itemId`, `ownerProfileId`, `qty`, `creditCents`, `lotId`, `createdItem`), `voidedAt`, `voidedBy`.
- **adjustments**: `itemId`, `qtyDelta`, `reason` (damaged / lost / kept / count correction / found), `note`.
- **priceHistory**: `itemId`, `marketPriceCents`, `recordedAt`, `recordedBy`, `source`. Written in the same batch as any market price change.
- **shows**: `name`, `startsOn`, `endsOn`, `venue`, `tableFeeCents`, `status` (planned / live / closed), `notes`, `participants[]` (`profileId`, `openingFloatCents`, `closingCashCents`).
- **showExpenses**: `showId` (nullable: null = not tied to a show), `description`, `category` (Table fee / Travel / Food / Supplies / Postage / Other; older records have none), `incurredOn` (YYYY-MM-DD), `amountCents`, `paidByProfileId`, `splitPct`, `settledAt` (nullable). Settled costs no longer count towards what is owed. Show settlement still counts every cost on the show, settled or not.
- **savedViews**: `profileId`, `name`, `screen`, `config`.
- **importBatches**: `profileId`, `filename`, `mapping`, `rowCount`, `undoneAt`.
- **auditLog**: `at`, `actorProfileId`, `targetProfileId`, `entity`, `entityId`, `action`, `diff` (before/after), `showId`. Create-only.

### Security rules

- Sign-in is open (anyone can sign in with Google), but only **approved, verified emails** listed in `firestore.rules` (`approvedEmails()`) can read or write data. Everyone else who signs in sees nothing. To add a person, add their Google email there and redeploy the rules.
- No `delete` on any collection. `auditLog` is create-only (no update).
- Sales: after creation, only `voidedAt` / `voidedBy` may change.
- Light validation on writes (money fields are integers, `profileId` is `p1` or `p2`).
- In the Firebase console: disable new sign-ups (Authentication, Settings), so the account list stays at one user.
- Because both people use one login, these rules protect against outsiders, not against one profile editing the other's data.

## Screens

1. **Login.**
2. **Inventory** (home). Virtualised dense table, inline cell editing, column sort/filter/show/hide, multi-select with bulk delete / mark stickered, saved views, profile switcher (Freddie / Ferrell / Combined). Flags column: low stock, stale price, needs re-sticker, oversold.
3. **Item drawer.** All fields, lots (add / edit / remaining), price history chart, sales of this item, audit trail, photo.
4. **Quick add.** Modal with type-ahead from existing items (same card → add a lot instead of a duplicate row). Enter to save and add another.
5. **Quick sell.** Search → item → price pre-filled from sticker → payment method → Enter. Can add more lines for a bundle, apply a bundle discount, split payment. Optional Trade-in section for cards the customer hands over. Toast with Undo.
6. **Reprice mode.** Steps through items with the oldest market prices; type a price, Enter moves to the next. Needed because all pricing is manual.
7. **Import wizard.** Upload CSV → pick preset (Collectr / generic) → map columns → preview with validation and duplicate matching → import. Each import can be undone as a whole.
8. **Shows.** List and detail: fee, expenses, participants, float.
9. **Show mode.** Full-screen: large search bar, quick sell, running takings (total and per payment method, per profile), recent sales with undo, "selling as" switch, sync status.
10. **Show summary.** Sales, revenue, cost and profit per profile; expense split; cash reconciliation (float + cash sales vs counted); settlement showing who owes whom, including money one person collected for the other's stock.
11. **Dashboard** (per profile, or combined). Market value, cost, unrealised profit, top movers, low stock, recent sales, stale prices, sell-through.
12. **Reports.** Sales log filterable by profile / show / date range / payment method; a Trades tab (what went out, what came in, credit, cash difference); profit per card; Australian financial year presets (1 July – 30 June); CSV export.
13. **Expenses.** Add a cost (category, amount, date, who paid, optional show, equal or custom split); list with filters by show and category; balance ("Ferrell owes Freddie $X") on unsettled costs; Settle up (undoable); CSV export. Table fees entered on a show appear here too.
14. **Audit log.** Filterable by actor, profile, entity, date.
15. **Trash.** Soft-deleted items, lots and voided sales with restore.
16. **Settings.** Profile, sticker multiplier and rounding, thresholds, theme, data export.
17. **Shortcut cheat sheet** (`?`) and **command palette** (`Ctrl+K`).

### Keyboard shortcuts

`/` search · `N` add item · `S` quick sell · `Ctrl+Z` undo · `Ctrl+K` command palette · `?` cheat sheet · `G I` / `G D` / `G S` / `G R` / `G E` go to inventory / dashboard / shows / reports / expenses · `1` `2` `3` view Freddie's, Ferrell's or both people's stock · arrows + `Enter` to move and edit cells · `Esc` cancel · `X` select row · `Del` delete selected. Single-key shortcuts are disabled while a text field has focus.

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
- Tags.

### Deliberately left for later

Card metadata autocomplete from an external database, automatic price providers, printable price labels, barcode/camera scanning, a buylist calculator (offer X% of market), GST. On phones: multi-select and bulk actions in the inventory (open an item to edit or delete it), and inline cell editing (edit in the item panel instead).

## Existing inventory (Google Sheet "Inventory")

Read on 2026-11-10. Layout: two side-by-side blocks. **Left (columns A–E) is the friend's; right (columns F–J) is the owner's.**

Answers from the owner (resolved):
- **Slab price is the market price.** Sticker is computed as market × 1.1, rounded like everything else. The friend's block is the only one with slabs (15 rows, $15,470).
- **Lucario SWSH 291:** quantity 8, market $32 each ($256 total), sticker $35 each. The "35 each" in the name is the sticker price, which matches 32 × 1.1 rounded.
- **"Sealed" means a sealed promo** (a single still in its sealed promo pack). Import as `kind = single` with variant "Sealed promo". Not a sealed-product item.
- **No purchase costs exist.** All opening lots import with null cost. Profit reports show opening-stock sales as revenue with "cost unknown" and keep them out of profit totals, so profit is never overstated. Costs can be added later per lot or in bulk, and reports then update.

Each block has Cards / Market / Sticker columns, a Total, a Bulk figure and a Slabs total. About 48 rows in the left block (plus 15 slabs) and 52 in the right.

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

## Progress

**Built and tested (all in the repo):**
- Pure domain logic with tests: money, sticker price and rounding, FIFO stock and cost, sales, carts, show takings, profit and settlement, reports, Australian financial years, safe CSV export.
- Write builders (change + audit entry + undo): items, lots, adjustments, sales and voids, shows, expenses, settings, bulk import, combined changes.
- Firestore layer (persistent offline cache, atomic batches) and an in-memory twin used for demos and UI tests.
- Screens: Inventory (virtual table, inline edit, saved views, bulk delete/move/mark stickered), item drawer (details, lots with editable cost, price chart, sales, history), quick add, quick sell, Show mode (cart, bundle discount, payment methods, takings, void), Shows and show detail (float, cash count, shared costs, profit, settlement), Dashboard, Sales log and profit per card with CSV export, Expenses (split and settle up), Reprice, Trash, Audit log, Settings and backups, Import wizard, command palette (`Ctrl+K`), shortcut sheet.
- Spreadsheet import: parses the two-block Google Sheet, cross-checks against its printed totals, imports as opening stock with unknown cost, one-click undo. Generic CSV import with column mapping and a price multiplier (Collectr-style headers are guessed; the real Collectr export has not been checked).
- Offline: service worker precaches the app (tested: reload and deep links open with no connection). Updates wait for a click so a sale is never interrupted.
- Phone layout (see Agreed decisions): bottom tab bar, card lists for stock, sales, trades, costs and reprice, bottom-sheet dialogs, touch-sized controls. Checked at 390px wide in a mobile browser emulator; not yet tried on a real phone.
- Look: dark pond-navy sidebar with icons, slim top bar with search and actions, rounded cards with soft shadows, Mudkip palette, light and dark. Combined view restored.
- Tests: 140+ unit tests (`npm test`), 15 Firestore rules tests against the emulator (`npm run test:rules`, needs Java), CI workflow runs both.
- Firebase project `damudkipspot-a430f`: Firestore (australia-southeast1) created, rules deployed, Google sign-in enabled, Vercel domains authorised. Vercel project has the `VITE_FIREBASE_*` variables and deploys on every push.

**Findings from the real sheet (worth remembering):**
- The sheet's printed "Total" figures add up the **sticker** column, not market. The left cards total is $1 off from its own rows (rounding).
- The left block's slab total ($15,470) is **$240 lower** than its 15 slabs ($15,710). The import uses the individual prices.
- Imported market values will therefore read about 9% below the sheet's totals.

**Not done / not verified:**
- **Not tested against live Firebase:** real Google sign-in, live snapshots and writes. The first real login is the first real test.
- The friend's own Google email is not on the approved list yet (only `damudkipspot@gmail.com` and `freddiechang918@gmail.com`).
- Photos (Firebase Storage needs the paid plan on new projects), split payments by hand (a trade's credit plus balance is the only split), saved views are per laptop (not shared), automatic price providers, scheduled backups.
- Collectr preset unverified against a real export.

## Build order

Each phase ends with passing tests and a working app.

0. **Scaffold.** Vite + React + TS, Tailwind, routing, dark mode, Vitest, `vercel.json`, `.env.example`, Firebase init.
1. **Domain logic (pure, tested).** Money, sticker price and rounding, FIFO and stock derivation, sale validation and totals, CSV/price parsing. Tests: sale flow, FIFO, oversold, void.
2. **Firestore layer.** Persistent cache, typed collections, live store, `writeBatch` helpers that write change + audit together, soft delete, undo stack, sync status pill. Security rules and rules tests.
3. **Auth and shell.** Login, session persistence, profile switcher, PWA service worker.
4. **Inventory.** Table, inline edit, quick add, lots, bulk actions, soft delete, Trash, item drawer, audit log screen.
5. **Sales.** Quick sell, multi-line, payments, void/undo. Tests: sale flow unit + end to end.
6. **Import.** Wizard, Collectr preset, generic mapping, duplicate matching, import undo. Plus the one-off migration of the existing Google Sheet (see "Existing inventory").
7. **Pricing.** Sticker computation and override, price history chart, Reprice mode, stale and re-sticker flags.
8. **Shows.** CRUD, Show mode, expenses, float, summary and settlement.
9. **Dashboard and reports.** Metrics, sales log, profit per card, CSV export.
10. **Polish.** Saved views, command palette, cheat sheet, photos, full export, narrow-screen check, performance pass with 10,000 seeded items.

## Risks

| Risk | Mitigation |
|---|---|
| Single shared login: no real separation between profiles | Accepted by the owners. Audit log records the acting profile; soft deletes; undo. Rules still block outsiders. |
| Firestore free-tier read/write limits | Live listeners from cache, no polling, per-screen limits on history/audit, batched imports. Watch usage in the Firebase console. |
| Offline writes lost if browser storage is cleared before sync | Request persistent storage; show pending-write count; block sign-out with pending writes; never use private browsing at a show. |
| App will not load offline after a reload | Service worker precaches the shell; test with network disabled. |
| No server means no enforced invariants | Money/profile validation in rules; domain logic is pure and tested; stock is derived so it cannot go out of sync. |
| Same field edited on both laptops offline | Last write wins; before/after is in the audit log. |
| Collectr export differs from the preset, or prices are in USD | Build the preset from a real export; mapping step allows manual fixes; imported prices flagged for review. |
| FIFO lots slow data entry | Quick add creates the item and first lot in one step. |
| No point-in-time recovery | Full data export (JSON/CSV) from Settings; consider scheduled Firestore export if moved to a paid plan. |
| Rules untested without the emulator | Run rules tests in CI with the Firebase emulator (needs Java). |

## Needed from the owner

- Add the friend's Google email to `approvedEmails()` in `firestore.rules` if they will sign in with their own account, then deploy the rules (Firebase console, or ask Claude).
- Sign in once on the live site and confirm stock loads, then import the spreadsheet (Import button, File > Download > CSV from Google Sheets).
- A real Collectr CSV export when needed, to check the generic import mapping.
- Revoke any access tokens that were shared in chat (Vercel token) and change the Google password that was pasted.

## Commands

- `npm run dev` then open `/?demo` for a sample-data copy with no Firebase (dev builds only); `/?demo=empty` starts empty.
- `npm test` unit tests, `npm run typecheck`, `npm run build`, `npm run test:rules` (Firestore emulator, needs Java).
- Rules deploy: Firebase console, or the Rules REST API with an access token.

## Conventions

- Money is integer cents; format with `Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })`.
- Dates stored as UTC `timestamptz`; displayed in the browser's timezone. Financial year = 1 July to 30 June.
- No component reads Firestore directly. Reads come from the live store; writes go through helpers that batch the change with its audit entry.
- Every screen must work in both layouts. Use `useIsMobile()` to render a card list instead of a table on phones; Tailwind `max-md:` for small tweaks. Inputs are 16px on phones so iOS does not zoom, and bars respect the safe-area inset.
- Business logic (money, sticker, FIFO, sales) lives in `src/domain` as pure functions with tests; no Firebase imports there.
- Every write helper needs: Zod validation, an audit entry, an inverse for undo, and a test.
- Changes to `firestore.rules` need a rules test.
