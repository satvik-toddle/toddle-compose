declare module '@toddle-edu/ds-data-grid' {
  import type {
    CSSProperties,
    ForwardRefExoticComponent,
    ReactElement,
    RefAttributes,
  } from 'react';

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

  // A cell's position in the grid, by index and by id. colId is absent only for
  // cells outside the header-mapped area (e.g. row markers).
  export interface DataGridCellCoords {
    row: number;
    col: number;
    rowId: string;
    colId?: string | number;
  }

  // Options are forwarded verbatim to the ds-web DropdownMenu, so its option shape
  // applies: icon renders before the label, suffix at the far right of the row.
  export interface DataGridContextMenuOption {
    key: string;
    label?: string;
    icon?: ReactElement;
    suffix?: ReactElement;
    isDivider?: boolean;
    isDestructive?: boolean;
  }

  // Right-click menu attached per cell — see Storybook "Data Grid > Docs".
  // onClick also receives the coordinates of the cell the menu was opened on.
  export interface DataGridContextMenu {
    options: DataGridContextMenuOption[];
    onClick: (option: DataGridContextMenuOption, cell: DataGridCellCoords) => void;
    closeOnSelect?: boolean;
    hasMultilineOptions?: boolean;
    allowOverflow?: boolean;
    // Replaces the grid's default overlay styles wholesale — restate position and
    // zIndex when overriding (defaults: position "relative", zIndex 1000).
    containerStyles?: CSSProperties;
  }

  export interface DataGridCell {
    cellType: DataGridCellType;
    value: unknown;
    isEditable?: boolean;
    contextMenu?: DataGridContextMenu;
    [key: string]: unknown;
  }

  export interface DataGridRow {
    rowId: string;
    columns: DataGridCell[];
    [key: string]: unknown;
  }

  // One entry in the array passed to onCellEdit.
  export interface DataGridCellEdit {
    cellCoods: DataGridCellCoords;
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

  export const DataGrid: ForwardRefExoticComponent<DataGridProps & RefAttributes<DataGridRef>>;
}
