# damudkipspot

Stock, sales and show tracker for two trading card vendors (Freddie and Ferrell). Prices are AUD. Works offline at card shows.

See `CLAUDE.md` for the design, decisions and status.

## Run it

```bash
npm install
npm run dev
```

Open `http://localhost:5173/?demo` for a copy with sample data and no sign-in (dev only).

For the real thing, copy `.env.example` to `.env.local` and fill in the Firebase web app values.

## Checks

```bash
npm run typecheck
npm test
npm run build
npm run test:rules   # Firestore rules against the emulator (needs Java)
```

## Deploy

Vercel builds every push (Vite preset). Set the `VITE_FIREBASE_*` variables in the Vercel project.
Firestore rules live in `firestore.rules`. Deploy them from the Firebase console after any change, and run `npm run test:rules` first.
