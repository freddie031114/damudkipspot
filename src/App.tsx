import { useEffect, useState, type FormEvent } from 'react'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { auth, firebaseReady, missingFirebaseConfig } from './lib/firebase'
import { DEFAULT_NAMES, PROFILE_IDS, useActingProfile } from './lib/profile'

const card = 'mx-auto mt-24 max-w-md rounded-lg border border-slate-300 p-6 dark:border-slate-700'
const input = 'w-full rounded border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-600'
const button = 'rounded bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500 disabled:opacity-50'

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
  const [email, setEmail] = useState('damudkipspot@gmail.com')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signInWithEmailAndPassword(auth!, email, password)
    } catch {
      setError('Sign in failed. Check the password, and that you are online the first time.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className={card}>
      <h1 className="mb-4 text-xl font-semibold">Card Stock</h1>
      <label className="mb-3 block text-sm">Email
        <input className={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
      </label>
      <label className="mb-4 block text-sm">Password
        <input className={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
      </label>
      {error && <p role="alert" className="mb-3 text-sm text-red-500">{error}</p>}
      <button className={button} disabled={busy}>Sign in</button>
    </form>
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

function Home({ user }: { user: User }) {
  const { acting, setActing } = useActingProfile()
  const [online, setOnline] = useState(navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return (
    <div>
      <header className="flex items-center gap-3 border-b border-slate-300 px-4 py-2 dark:border-slate-700">
        <strong>Card Stock</strong>
        <span className="ml-auto text-sm">{online ? 'Online' : 'Offline: changes will sync later'}</span>
        <select aria-label="Acting profile" className={input + ' !w-auto'} value={acting ?? ''} onChange={(e) => setActing(e.target.value as 'p1' | 'p2')}>
          {PROFILE_IDS.map((p) => <option key={p} value={p}>{DEFAULT_NAMES[p]}</option>)}
        </select>
        <button className="text-sm underline" onClick={() => void signOut(auth!)}>Sign out ({user.email})</button>
      </header>
      <main className="p-4">Inventory screen is the next build step.</main>
    </div>
  )
}

export function App() {
  const { acting } = useActingProfile()
  const [user, setUser] = useState<User | null | undefined>(undefined)
  useEffect(() => (auth ? onAuthStateChanged(auth, setUser) : undefined), [])

  if (!firebaseReady) return <SetupNeeded />
  if (user === undefined) return <p className="p-6">Loading…</p>
  if (!user) return <Login />
  if (!acting) return <WhoIsThis />
  return <Home user={user} />
}
