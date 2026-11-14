import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-damudkipspot',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})
afterAll(() => env.cleanup())
beforeEach(() => env.clearFirestore())

const APPROVED = 'damudkipspot@gmail.com'
const owner = () => env.authenticatedContext('u1', { email: APPROVED, email_verified: true }).firestore()
const second = () => env.authenticatedContext('u2', { email: 'freddiechang918@gmail.com', email_verified: true }).firestore()
const stranger = () => env.authenticatedContext('u3', { email: 'stranger@gmail.com', email_verified: true }).firestore()
const unverified = () => env.authenticatedContext('u4', { email: APPROVED, email_verified: false }).firestore()
const anon = () => env.unauthenticatedContext().firestore()

const item = (over: Record<string, unknown> = {}) => ({ id: 'i1', profileId: 'p1', name: 'Gengar', marketPriceCents: 1000, deletedAt: null, ...over })
const lot = (over: Record<string, unknown> = {}) => ({ id: 'l1', itemId: 'i1', profileId: 'p1', qty: 2, unitCostCents: null, deletedAt: null, ...over })
const sale = (over: Record<string, unknown> = {}) => ({
  id: 's1', soldByProfileId: 'p1', lines: [{ itemId: 'i1', qty: 1, unitPriceCents: 1000 }], payments: [], voidedAt: null, voidedBy: null, updatedAt: 1, updatedBy: 'p1', ...over,
})

describe('who can get in', () => {
  it('blocks signed-out visitors', async () => {
    await assertFails(getDoc(doc(anon(), 'items/i1')))
    await assertFails(setDoc(doc(anon(), 'items/i1'), item()))
  })
  it('blocks any other Google account, even a verified one', async () => {
    await assertFails(getDoc(doc(stranger(), 'items/i1')))
    await assertFails(setDoc(doc(stranger(), 'items/i1'), item()))
  })
  it('blocks an approved email that is not verified', async () => {
    await assertFails(setDoc(doc(unverified(), 'items/i1'), item()))
    await assertFails(getDoc(doc(unverified(), 'items/i1')))
  })
  it('lets both approved accounts read and write', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'items/i1'), item()))
    await assertSucceeds(getDoc(doc(second(), 'items/i1')))
    await assertSucceeds(updateDoc(doc(second(), 'items/i1'), { name: 'Gengar V' }))
  })
  it('blocks collections the app does not use', async () => {
    await assertFails(setDoc(doc(owner(), 'secrets/x'), { a: 1 }))
    await assertFails(getDoc(doc(owner(), 'secrets/x')))
  })
})

describe('no hard deletes', () => {
  it('refuses to delete anything', async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'items/i1'), item())
      await setDoc(doc(c.firestore(), 'shows/sh1'), { id: 'sh1', name: 'S' })
      await setDoc(doc(c.firestore(), 'auditLog/a1'), { id: 'a1', actorProfileId: 'p1' })
    })
    for (const path of ['items/i1', 'shows/sh1', 'auditLog/a1']) await assertFails(deleteDoc(doc(owner(), path)))
  })
  it('allows soft delete', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'items/i1'), item()))
    await assertSucceeds(setDoc(doc(owner(), 'items/i1'), { deletedAt: 5 }, { merge: true }))
  })
})

describe('items and lots', () => {
  it('rejects bad profile ids and prices', async () => {
    await assertFails(setDoc(doc(owner(), 'items/i1'), item({ profileId: 'p3' })))
    await assertFails(setDoc(doc(owner(), 'items/i1'), item({ marketPriceCents: -1 })))
    await assertFails(setDoc(doc(owner(), 'items/i1'), item({ marketPriceCents: 10.5 })))
  })
  it('lots need a whole positive quantity and a non-negative whole cost, or no cost', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'lots/l1'), lot()))
    await assertSucceeds(setDoc(doc(owner(), 'lots/l2'), lot({ id: 'l2', unitCostCents: 250 })))
    await assertFails(setDoc(doc(owner(), 'lots/l3'), lot({ id: 'l3', qty: 0 })))
    await assertFails(setDoc(doc(owner(), 'lots/l3'), lot({ id: 'l3', qty: 1.5 })))
    await assertFails(setDoc(doc(owner(), 'lots/l3'), lot({ id: 'l3', unitCostCents: -5 })))
  })
})

describe('sales are immutable except for voiding', () => {
  it('creates a sale, but not an already-voided or empty one', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'sales/s1'), sale()))
    await assertFails(setDoc(doc(owner(), 'sales/s2'), sale({ id: 's2', voidedAt: 9 })))
    await assertFails(setDoc(doc(owner(), 'sales/s3'), sale({ id: 's3', lines: [] })))
    await assertFails(setDoc(doc(owner(), 'sales/s4'), sale({ id: 's4', soldByProfileId: 'p9' })))
  })
  it('allows a straight buy: cards in and nothing out, but not a deal with neither', async () => {
    const tradeIns = [{ itemId: 'i1', ownerProfileId: 'p1', qty: 2, creditCents: 500, lotId: 'l1', createdItem: false }]
    await assertSucceeds(setDoc(doc(owner(), 'sales/b1'), sale({ id: 'b1', lines: [], tradeIns })))
    await assertFails(setDoc(doc(owner(), 'sales/b2'), sale({ id: 'b2', lines: [], tradeIns: [] })))
    await assertFails(setDoc(doc(stranger(), 'sales/b3'), sale({ id: 'b3', lines: [], tradeIns })))
  })
  it('lets a sale be voided once, and nothing else be changed', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'sales/s1'), sale()))
    await assertFails(updateDoc(doc(owner(), 'sales/s1'), { lines: [] }))
    await assertFails(updateDoc(doc(owner(), 'sales/s1'), { discountCents: 99999 }))
    await assertSucceeds(updateDoc(doc(owner(), 'sales/s1'), { voidedAt: 7, voidedBy: 'p1', updatedAt: 7, updatedBy: 'p1' }))
    await assertFails(updateDoc(doc(owner(), 'sales/s1'), { voidedAt: 8, voidedBy: 'p2', updatedAt: 8, updatedBy: 'p2' }))
  })
})

describe('audit log is create-only', () => {
  it('creates entries but never edits them', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'auditLog/a1'), { id: 'a1', actorProfileId: 'p1', action: 'create' }))
    await assertFails(updateDoc(doc(owner(), 'auditLog/a1'), { action: 'changed' }))
    await assertFails(setDoc(doc(owner(), 'auditLog/a2'), { id: 'a2', actorProfileId: 'p9' }))
  })
})

describe('profiles, shows and the rest', () => {
  it('profiles only exist for p1 and p2', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'profiles/p1'), { id: 'p1', settings: { rounding: '1' } }))
    await assertFails(setDoc(doc(owner(), 'profiles/p3'), { id: 'p3' }))
  })
  it('shows, expenses, import batches and saved views work for approved users only', async () => {
    for (const path of ['shows/sh1', 'showExpenses/e1', 'importBatches/b1', 'savedViews/v1']) {
      await assertSucceeds(setDoc(doc(owner(), path), { id: 'x' }))
      await assertFails(setDoc(doc(stranger(), path), { id: 'x' }))
    }
  })
  it('price history can be added but not rewritten', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'priceHistory/p1'), { id: 'p1', itemId: 'i1', marketPriceCents: 100 }))
    await assertFails(updateDoc(doc(owner(), 'priceHistory/p1'), { marketPriceCents: 1 }))
  })
})
