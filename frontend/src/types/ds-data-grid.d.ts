declare module '@toddle-edu/ds-data-grid' {
  import type { ComponentType } from 'react';

  // The cell renderers ds-data-grid ships (see Storybook "Data Grid > Cells").
  export type DataGridCellType =
    | 'text'
    | 'number'
    | 'dropdown'
    | 'checkbox'
    | 'tag'
    | 'dateTime'
    | 'label'
    | 'icon'
    | 'media'
    | 'progress'
    | 'radio'
    | 'toggle'
    | 'chip'
    | 'colorPicker'
    | 'comment'
    | 'student'
    | 'rowCollapse'
    | 'skeleton';

  export interface DataGridHeader {
    id: string | number;
    title: string;
    width?: number;
    minWidth?: number;
    maxWidth?: number;
    tooltip?: string;
    [key: string]: unknown;
  }

  export interface DataGridCell {
    cellType: DataGridCellType;
    value: unknown;
    isEditable?: boolean;
    [key: string]: unknown;
  }

  export interface DataGridRow {
    rowId: string;
    columns: DataGridCell[];
    [key: string]: unknown;
  }

  // One entry in the array passed to onCellEdit.
  export interface DataGridCellEdit {
    cellCoods: { row: number; col: number; rowId: string; colId?: string | number };
    newValue: DataGridCell & { value: unknown };
    changeType?: 'paste' | 'undo' | 'redo';
  }

  export interface DataGridProps {
    headers: DataGridHeader[];
    data: DataGridRow[];
    onCellEdit?: (edits: DataGridCellEdit[]) => void;
    onAppendRowAtEnd?: () => void;
    isViewMode?: boolean;
    dataGridHeight?: number | string;
    dataGridWidth?: number | string;
    rowHeight?: number;
    // The bundle accepts more props than we declare; stay permissive.
    [key: string]: unknown;
  }

  export const DataGrid: ComponentType<DataGridProps>;
}
