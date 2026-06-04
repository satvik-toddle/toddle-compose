import { DocEditor } from '@toddle-edu/ds-doc-editor';

// Stylesheets required by the editor (mirrors the doc-editor playground).
import '@toddle-edu/ds-web/dist/assets/antd.css';
import '@toddle-edu/ds-web/dist/assets/main.css';
import '@toddle-edu/ds-doc-editor/dist/main.css';

export function App() {
  return <DocEditor />;
}
