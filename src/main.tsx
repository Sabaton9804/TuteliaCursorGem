import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import { appQueryClient } from './lib/query-client';
import './index.css';
/** Baseline; los visores vuelven a llamar ensurePdfJsWorker() tras importar react-pdf. */
import { ensurePdfJsWorker } from './lib/pdfjs-worker';
import { setupChunkLoadRecovery, resetRecoveryLevel } from './utils/chunkLoadRecovery';
import { clearPwaUpdatePending } from './utils/hardAppRefresh';

setupChunkLoadRecovery();

ensurePdfJsWorker();

window.setTimeout(() => {
  resetRecoveryLevel();
  clearPwaUpdatePending();
}, 4_000);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={appQueryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>
);
