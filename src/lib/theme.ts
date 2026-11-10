const KEY = 'damudkipspot.theme'
type Pref = 'light' | 'dark'

function saved(): Pref | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

const apply = (dark: boolean) => document.documentElement.classList.toggle('dark', dark)

/** Dark mode follows the OS until the user picks one with the Theme button. */
export function initTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)')
  const sync = () => apply((saved() ?? (mq.matches ? 'dark' : 'light')) === 'dark')
  sync()
  mq.addEventListener('change', sync)
}

export function toggleTheme() {
  const next: Pref = document.documentElement.classList.contains('dark') ? 'light' : 'dark'
  apply(next === 'dark')
  try {
    localStorage.setItem(KEY, next)
  } catch {
    /* storage unavailable: applies for this session only */
  }
}
