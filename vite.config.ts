/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // "prompt": a new version waits until you choose to reload, so an update can never
      // wipe a half-finished sale at the table.
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'damudkipspot',
        short_name: 'damudkipspot',
        description: 'Card stock, sales and shows',
        theme_color: '#1b78b8',
        background_color: '#f3fafe',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The whole app is cached so it opens with no connection. Firestore handles its own offline data.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/__\//],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4_000_000,
      },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
