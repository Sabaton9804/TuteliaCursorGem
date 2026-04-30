import { QueryClient } from '@tanstack/react-query';
import { COURT_CASES_STALE_MS } from './court-cases-query';

export const appQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: COURT_CASES_STALE_MS,
      gcTime: 10 * 60 * 1000,
      retry: 1,
    },
  },
});
