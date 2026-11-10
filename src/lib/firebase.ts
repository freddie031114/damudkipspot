import { initializeApp } from 'firebase/app'
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth'
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'

const env = import.meta.env

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
}

/** Names of required settings that are missing, so the UI can say exactly what to add. */
export const missingFirebaseConfig = (['apiKey', 'authDomain', 'projectId', 'appId'] as const).filter(
  (k) => !firebaseConfig[k],
)

export const firebaseReady = missingFirebaseConfig.length === 0

const app = firebaseReady ? initializeApp(firebaseConfig) : null

export const auth = app ? getAuth(app) : null
if (auth) void setPersistence(auth, browserLocalPersistence)

// Local cache + queued offline writes. Multi-tab so two tabs on one laptop don't conflict.
export const db = app
  ? initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      ignoreUndefinedProperties: true,
    })
  : null
