// @toddle-edu/ds-data-grid ships no type definitions, so we declare the surface
// we use. Props are intentionally loose for now — we mount the grid with sample
// data (see src/DataGridView.tsx). Tighten these as we adopt the real API.
declare module '@toddle-edu/ds-data-grid' {
  import type { ComponentType } from 'react';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const DataGrid: ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const GradebookDataGrid: ComponentType<any>;
}
