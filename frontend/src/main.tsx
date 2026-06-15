import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
// Deep import avoids pulling the entire ds-web barrel just for the provider.
import { DSProvider } from '@toddle-edu/ds-web/dist/Utils/DSContext';
import { createQueryClient } from './lib/queryClient';
import { bootstrapAuth } from './lib/http';
import { App } from './App';
// DS base styles must load before our own so app styles can override them.
import '@toddle-edu/ds-web/dist/assets/antd.css';
import '@toddle-edu/ds-web/dist/assets/main.css';
import './styles/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

const queryClient = createQueryClient();
// Restore the session (refresh + re-enter last workspace) before first paint.
void bootstrapAuth();

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DSProvider dsVersion="2.0">
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </DSProvider>
    </QueryClientProvider>
  </StrictMode>,
);
