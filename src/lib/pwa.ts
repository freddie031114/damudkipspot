import { registerSW } from 'virtual:pwa-register'

export const PWA_UPDATE_EVENT = 'damudkipspot:update-ready'
let applyUpdate: (() => Promise<void>) | null = null

/** Registers the service worker (production only). When a new version is ready, the app is told. */
export function initPwa() {
  if (!import.meta.env.PROD) return
  const update = registerSW({
    onNeedRefresh() {
      applyUpdate = () => update(true)
      window.dispatchEvent(new Event(PWA_UPDATE_EVENT))
    },
  })
}

export function applyPwaUpdate() {
  void applyUpdate?.()
}
