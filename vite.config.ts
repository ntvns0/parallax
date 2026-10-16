import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'service-worker.ts',
      injectRegister: false,
      injectManifest: { maximumFileSizeToCacheInBytes: 12 * 1024 * 1024 },
      manifest: {
        name: 'Parallax CAD',
        short_name: 'Parallax',
        description: 'Local-first parametric mechanical modeling',
        theme_color: '#101212',
        background_color: '#101212',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/parallax-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    // This machine's Tailscale name, so the dev server opens from other devices.
    allowedHosts: ['fedora'],
  },
})
