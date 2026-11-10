import { DEFAULT_NAMES } from '../lib/profile'
import type { ProfileId } from '../data/types'

export const nameOf = (p: ProfileId) => DEFAULT_NAMES[p]

const dtf = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const df = new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
export const fmtDateTime = (ts: number) => dtf.format(new Date(ts))
export const fmtDate = (ts: number) => df.format(new Date(ts))

/** "2026-12-05" to a readable local date without timezone shifting. */
export function fmtIsoDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return df.format(new Date(y, m - 1, d))
}

export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const methodLabel: Record<string, string> = { cash: 'Cash', card: 'Card', payid: 'PayID', trade: 'Trade' }
