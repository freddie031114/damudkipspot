import { useMemo } from 'react'
import { saleLineCosts } from '../data/derive'
import { useStore } from '../data/store'
import { summarizeShow } from '../domain/show'

/** Everything the show screens need: the show, its sales and expenses, and the computed summary. */
export function useShow(showId: string | undefined) {
  const { raw } = useStore()
  return useMemo(() => {
    const show = raw.shows.find((s) => s.id === showId && !s.deletedAt)
    if (!show) return null
    const sales = raw.sales.filter((s) => s.showId === show.id).sort((a, b) => b.soldAt - a.soldAt)
    const expenses = raw.showExpenses.filter((e) => e.showId === show.id && !e.deletedAt)
    const summary = summarizeShow({ sales, expenses, participants: show.participants, costOf: saleLineCosts(raw) })
    return { show, sales, expenses, summary }
  }, [raw, showId])
}
