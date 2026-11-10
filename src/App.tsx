import { useEffect, useMemo, useState } from 'react'
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth'
import { auth, db, firebaseReady, missingFirebaseConfig } from './lib/firebase'
import { firestoreSource } from './data/firestoreSource'
import { demoSource } from './data/demoSeed'
import { StoreProvider } from './data/store'
import type { DataSource } from './data/source'
import { Logo } from './ui/Logo'
import { Shell } from './ui/Shell'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile } from './lib/profile'

const card = 'mx-auto mt-24 max-w-md rounded-2xl border border-line bg-surface p-8 shadow-card'
const button = 'rounded-lg bg-brand px-4 py-2 font-medium text-brand-fg shadow-sm transition-colors hover:bg-brand-hover disabled:opacity-50'

function SetupNeeded() {
  return (
    <main className={card}>
      <h1 className="mb-2 text-xl font-semibold">Firebase is not configured</h1>
      <p className="mb-2 text-sm">Add these to <code>.env.local</code> (and to the Vercel project's environment variables):</p>
      <ul className="list-disc pl-5 text-sm">
        {missingFirebaseConfig.map((k) => (
          <li key={k}><code>VITE_FIREBASE_{k.replace(/[A-Z]/g, (c) => '_' + c).toUpperCase()}</code></li>
        ))}
      </ul>
    </main>
  )
}

function Login() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function google() {
    setBusy(true)
    setError('')
    try {
      await signInWithPopup(auth!, new GoogleAuthProvider())
    } catch (e) {
      const code = (e as { code?: string }).code ?? ''
      setError(
        code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' ? '' :
        code === 'auth/popup-blocked' ? 'Your browser blocked the sign-in popup. Allow popups for this site and try again.' :
        code === 'auth/unauthorized-domain' ? 'This web address is not authorised for sign-in in Firebase.' :
        code === 'auth/network-request-failed' ? 'No connection. You need to be online the first time you sign in.' :
        'Sign in failed. Try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className={card}>
      <div className="mb-4 flex justify-center"><Logo size={64} /></div>
      <h1 className="mb-4 text-center text-2xl font-bold">da<span className="text-brand">mudkip</span>spot</h1>
      {error && <p role="alert" className="mb-3 text-sm text-red-500">{error}</p>}
      <button className={button} disabled={busy} onClick={() => void google()}>Sign in with Google</button>
      <p className="mt-3 text-xs opacity-70">Only approved Google accounts can see the stock.</p>
    </main>
  )
}

function WhoIsThis() {
  const { setActing } = useActingProfile()
  return (
    <main className={card}>
      <h1 className="mb-4 text-xl font-semibold">Who's using this laptop?</h1>
      <div className="flex gap-3">
        {PROFILE_IDS.map((p) => (
          <button key={p} className={button} onClick={() => setActing(p)}>{DEFAULT_NAMES[p]}</button>
        ))}
      </div>
    </main>
  )
}

const DEMO = import.meta.env.DEV && new URLSearchParams(location.search).has('demo')

export function App() {
  const { acting } = useActingProfile()
  const [user, setUser] = useState<User | null | undefined>(undefined)
  useEffect(() => (auth ? onAuthStateChanged(auth, setUser) : undefined), [])
  const source = useMemo<DataSource | null>(() => (DEMO ? demoSource(new URLSearchParams(location.search).get('demo') === 'empty') : db && user ? firestoreSource(db) : null), [user])

  if (DEMO) {
    if (!acting) return <WhoIsThis />
    return <StoreProvider source={source!}><Shell email="demo" /></StoreProvider>
  }
  if (!firebaseReady) return <SetupNeeded />
  if (user === undefined) return <p className="p-6">Loading…</p>
  if (!user) return <Login />
  if (!acting) return <WhoIsThis />
  return (
    <StoreProvider source={source!}>
      <Shell email={user.email ?? ''} onSignOut={() => void signOut(auth!)} />
    </StoreProvider>
  )
}
