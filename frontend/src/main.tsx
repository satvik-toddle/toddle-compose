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
// Load order matters. ds-web main.css is the DS's *compiled* bundle (utilities +
// Preflight + tokens); our styles/tailwind.css (utilities only, Preflight off) loads
// AFTER it so our utilities win at equal specificity, but BEFORE index.css so rbac
// component rules + index typography stay authoritative. Don't import
// ds-web/dist/assets/tailwind.css — that's uncompiled source and fails to build.
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
  <QueryClientProvider client={queryClient}>
    <DSProvider dsVersion="2.0">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </DSProvider>
  </QueryClientProvider>,
);
