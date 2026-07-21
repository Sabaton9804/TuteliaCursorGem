import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { appQueryClient } from './lib/query-client';
import './index.css';
/** Baseline; los visores vuelven a llamar ensurePdfJsWorker() tras importar react-pdf. */
import { ensurePdfJsWorker } from './lib/pdfjs-worker';

ensurePdfJsWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={appQueryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
