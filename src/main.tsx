import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { appQueryClient } from './lib/query-client';
import './index.css';
/** Debe ir al final: react-pdf resetea el worker al importarse; aquí lo volvemos a fijar al bundle de Vite. */
import './lib/pdfjs-worker';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={appQueryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
