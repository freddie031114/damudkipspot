import { createContext, useContext, useState, type ReactNode } from 'react'

export type ProfileId = 'p1' | 'p2'
export const PROFILE_IDS: ProfileId[] = ['p1', 'p2']
export const DEFAULT_NAMES: Record<ProfileId, string> = { p1: 'Me', p2: 'Friend' }

const KEY = 'damudkipspot.actingProfile'

function load(): ProfileId | null {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'p1' || v === 'p2' ? v : null
  } catch {
    return null
  }
}

interface Ctx {
  /** Who is using the laptop right now. Recorded on every change and sale. */
  acting: ProfileId | null
  setActing: (p: ProfileId) => void
}

const ProfileContext = createContext<Ctx>({ acting: null, setActing: () => {} })

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [acting, setState] = useState<ProfileId | null>(load)
  const setActing = (p: ProfileId) => {
    setState(p)
    try {
      localStorage.setItem(KEY, p)
    } catch {
      /* storage unavailable: still works for this session */
    }
  }
  return <ProfileContext.Provider value={{ acting, setActing }}>{children}</ProfileContext.Provider>
}

export const useActingProfile = () => useContext(ProfileContext)
