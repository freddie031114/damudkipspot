import Papa from 'papaparse'

/** Parses CSV or tab-separated text (pasted from a spreadsheet) into a grid of strings. */
export function parseTable(text: string): string[][] {
  const res = Papa.parse<string[]>(text.replace(/^﻿/, ''), { skipEmptyLines: false })
  return res.data.map((r) => r.map((c) => (c ?? '').toString().trim()))
}
