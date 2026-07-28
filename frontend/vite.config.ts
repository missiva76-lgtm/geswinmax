import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate': o novo service worker assume o controlo assim que está pronto,
      // sem precisar que o utilizador feche todas as abas — importante porque este
      // projeto tem deploys frequentes e não queremos utilizadores presos numa
      // versão antiga em cache.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'GesWinmax',
        short_name: 'GesWinmax',
        description: 'Gestão WinMax4 — Emissão, Dados, Arquivo Digital e SAF-T',
        theme_color: '#0d7b6b',
        background_color: '#0d7b6b',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        id: '/',
        lang: 'pt',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Só pré-cacheia os ficheiros estáticos gerados pelo build (JS/CSS/HTML/ícones).
        // As chamadas à API (/api/...) e ao Firebase NUNCA são intercetadas ou colocadas
        // em cache pelo service worker — este é um sistema de faturação em tempo real,
        // e dados em cache (jobs, faturas, artigos) seriam ativamente enganadores se
        // servidos "stale" em vez de ir sempre à rede.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
      },
      devOptions: {
        // Facilita testar a instalação/PWA em ambiente de desenvolvimento (npm run dev)
        enabled: true,
      },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:3001' } },
})
