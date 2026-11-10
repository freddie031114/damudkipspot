import { createContext, useContext } from 'react'
import type { InventoryRow } from '../data/derive'
import type { View } from './Inventory'

export interface Ui {
  view: View
  setView: (v: View) => void
  search: string
  setSearch: (s: string) => void
  openAdd: () => void
  openSell: (row?: InventoryRow) => void
  openImport: () => void
  openKeys: () => void
  /** Opens the detail drawer for an item. */
  openItem: (id: string) => void
}

export const UiContext = createContext<Ui | null>(null)

export function useUi(): Ui {
  const v = useContext(UiContext)
  if (!v) throw new Error('useUi outside Shell')
  return v
}
