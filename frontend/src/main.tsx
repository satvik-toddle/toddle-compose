import { StrictMode } from 'react';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
// Deep import avoids pulling the entire ds-web barrel just for the provider.
import { DSProvider } from '@toddle-edu/ds-web/dist/Utils/DSContext';
import { createQueryClient } from './lib/queryClient';
import { bootstrapAuth } from './lib/http';
import { App } from './App';
// DS base styles must load before our own so app styles can override them.
// main.css is the DS's *compiled* bundle — it already includes the Tailwind
// utility classes (text-body, mt-3, flex, …), the full Preflight, and the tokens
// that web-app consumes. (Do NOT import dist/assets/tailwind.css — that's the
// uncompiled Tailwind source with @import "tailwindcss/base" and fails outside
// the DS's own build.)
//
// styles/tailwind.css is OUR app-owned Tailwind build (utilities only, Preflight
// off — see tailwind.config.js). It loads AFTER the DS bundle so our utilities
// win over DS utilities of equal specificity, but BEFORE index.css so rbac.css's
// `.rbac …` component rules and the index.css typography stay authoritative.
import '@toddle-edu/ds-web/dist/assets/antd.css';
import '@toddle-edu/ds-web/dist/assets/main.css';
import './styles/tailwind.css';
import './styles/index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

// @toddle-edu/ds-doc-editor's collaboration bundle references global React /
// ReactDOM (UMD externals) — expose them so its CollaborationPlugin can render.
Object.assign(window, { React, ReactDOM });

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
