import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    /** Permite usar NEXT_PUBLIC_SUPABASE_* del .env (típico de plantillas) además de VITE_*. */
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['icon.svg'],
        manifest: {
          name: 'Jurion',
          short_name: 'Jurion',
          description: 'Sistema operativo del despacho judicial en Colombia.',
          theme_color: '#0F172A',
          background_color: '#F8FAFC',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: '/icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any',
            },
            {
              src: '/icon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api/, /^\/_/, /\/[^/?]+\.[^/]+$/],
          runtimeCaching: [],
          cleanupOutdatedCaches: true,
          skipWaiting: false,
          clientsClaim: true,
          /** Bundle principal ~5.5 MB; límite Workbox por defecto 2 MiB. */
          maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        },
        devOptions: {
          enabled: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        /**
         * html2pdf.js importa `html2canvas`, que no entiende `oklch()` (Tailwind v4).
         * html2canvas-pro sí; sin esto el PDF maquetado falla y el overlay puede dejar la UI sin clics.
         */
        html2canvas: path.resolve(__dirname, 'node_modules/html2canvas-pro'),
      },
      dedupe: ['pdfjs-dist', 'html2canvas'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
