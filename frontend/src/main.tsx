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

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

ReactDOM.render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
  rootEl,
);
