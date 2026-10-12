import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isAuthError } from './api';
import { App } from './App';
import './theme.css';

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // When the session dies mid-use, re-read the auth status so the UI drops to login.
    onError: (error) => {
      if (isAuthError(error)) void queryClient.invalidateQueries({ queryKey: ['auth'] });
    },
  }),
  defaultOptions: {
    // The main process already retries transient failures.
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 60_000 },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
