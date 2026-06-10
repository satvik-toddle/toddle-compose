import './react-global'; // expose window.React/ReactDOM before the editor loads
import { StrictMode } from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';

// Stylesheets required by the embedded doc-editor.
import '@toddle-edu/ds-web/dist/assets/antd.css';
import '@toddle-edu/ds-web/dist/assets/main.css';
// Import the editor stylesheet by its real path (the package's exports map
// doesn't expose ./dist/main.css and resets across editor-repo branch switches).
import '/Users/apple/Documents/doc-editor/packages/doc-editor/dist/main.css';
// ds-data-grid extracts its styles (incl. the bundled glide-data-grid CSS) to
// dist/main.css; import by real path since the package exposes no css export.
import '/Users/apple/Documents/design-system/packages/common/ds-data-grid/dist/main.css';
// Toddle DS tokens + the RBAC / workspace-management surface styles (scoped to
// `.rbac`, so they don't collide with the editor's own type rules).
import './ds-tokens.css';
import './rbac.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

ReactDOM.render(
  <StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <App />
    </BrowserRouter>
  </StrictMode>,
  rootEl,
);
