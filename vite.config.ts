import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    /** Permite usar NEXT_PUBLIC_SUPABASE_* del .env (típico de plantillas) además de VITE_*. */
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    plugins: [react(), tailwindcss()],
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
