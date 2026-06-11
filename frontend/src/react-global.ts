// The linked @toddle-edu/ds-doc-editor is a UMD bundle that expects React /
// ReactDOM on the global object. Expose them BEFORE the editor module is
// imported (this file is imported first in main.tsx).
import * as React from 'react';
import * as ReactDOM from 'react-dom';

(window as any).React = React;
(window as any).ReactDOM = ReactDOM;
