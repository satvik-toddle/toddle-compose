declare module '@toddle-edu/ds-data-grid' {
  import type { ForwardRefExoticComponent, RefAttributes } from 'react';

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

  // A rectangular selection: top-left anchor (x=colId, y=rowId) plus a span.
  export interface DataGridRange {
    x: string | number;
    y: string;
    width: number;
    height: number;
  }

  // The imperative handle exposed via ref — see Storybook "Data Grid > Ref API".
  export interface DataGridRef {
    selection: {
      clear(): void;
      rows(rowIds: string[]): void;
      columns(colIds: Array<string | number>): void;
      cells(args: {
        cell?: [colId: string | number, rowId: string];
        range?: DataGridRange;
        rangeStack?: DataGridRange[];
      }): void;
    };
    scrollTo(args: {
      colId: string | number;
      rowId: string;
      direction?: 'horizontal' | 'vertical' | 'both';
      align?: {
        vAlign: 'start' | 'center' | 'end';
        hAlign: 'start' | 'center' | 'end';
      };
    }): void;
    toggleAllRowsCollapse(): void;
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

  export const DataGrid: ForwardRefExoticComponent<
    DataGridProps & RefAttributes<DataGridRef>
  >;
}
