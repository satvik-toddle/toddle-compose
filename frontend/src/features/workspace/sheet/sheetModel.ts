import * as Y from 'yjs';
import type {
  DataGridCell,
  DataGridCellEdit,
  DataGridHeader,
  DataGridRow,
} from '@toddle-edu/ds-data-grid';

// Yjs roots — these names MUST match the rtc-server's extractSheet
// (rtc-server/src/history/versions.service.ts): 'rows' is a Y.Array of per-row
// Y.Map keyed by '__id'; 'colTypes' is a Y.Map of column id -> cell type.
export const ROWS_KEY = 'rows';
export const COL_TYPE_KEY = 'colTypes';
const ID_KEY = '__id';

const COLUMN_COUNT = 26; // A–Z, Google-Sheets style
const COLUMN_WIDTH = 160;
export const SHEET_ROW_COUNT = 100;

// Column ids (A…Z) double as header titles. Phase 1 is a fixed all-text grid, so the
// columns are a static client constant rather than persisted in the doc.
const COLUMN_IDS = Array.from({ length: COLUMN_COUNT }, (_, i) => String.fromCodePoint(65 + i));
export const SHEET_COLUMNS: DataGridHeader[] = COLUMN_IDS.map((id) => ({
  id,
  title: id,
  width: COLUMN_WIDTH,
  styles: {
    align: 'center',
  },
}));

export type SheetRows = Y.Array<Y.Map<unknown>>;
export type SheetColTypes = Y.Map<unknown>;

const makeRowId = (): string => crypto.randomUUID();

const findRowMap = (yRows: SheetRows, rowId: string): Y.Map<unknown> | undefined =>
  yRows.toArray().find((row) => row.get(ID_KEY) === rowId);

// Map the Yjs rows into ds-data-grid rows — one all-text row per Y.Map; a cell whose
// column key is absent reads as an empty string.
export function readSheetRows(yRows: SheetRows, isEditable: boolean): DataGridRow[] {
  return yRows.toArray().map((row) => ({
    rowId: row.get(ID_KEY) as string,
    columns: COLUMN_IDS.map(
      (id): DataGridCell => ({
        cellType: 'text',
        value: (row.get(id) as string | undefined) ?? '',
        isEditable,
      }),
    ),
  }));
}

// Seed a brand-new sheet: A–Z text columns + SHEET_ROW_COUNT empty rows. The caller
// guards on "synced && empty" so an existing doc's rows are never duplicated.
export function seedSheet(ydoc: Y.Doc, yRows: SheetRows, yColTypes: SheetColTypes): void {
  ydoc.transact(() => {
    for (const id of COLUMN_IDS) yColTypes.set(id, 'text');
    const rows = Array.from({ length: SHEET_ROW_COUNT }, () => {
      const row = new Y.Map<unknown>();
      row.set(ID_KEY, makeRowId());
      return row;
    });
    yRows.push(rows);
  });
}

// Write the grid's cell edits back into the matching row Y.Maps (text values only).
export function applySheetEdits(ydoc: Y.Doc, yRows: SheetRows, edits: DataGridCellEdit[]): void {
  ydoc.transact(() => {
    for (const { cellCoods, newValue } of edits) {
      if (cellCoods.colId == null) continue;
      const row = findRowMap(yRows, cellCoods.rowId);
      if (row) row.set(String(cellCoods.colId), newValue?.value ?? '');
    }
  });
}

// Append one empty row — used when the user edits a cell in the last row.
export function appendSheetRow(ydoc: Y.Doc, yRows: SheetRows): void {
  const row = new Y.Map<unknown>();
  row.set(ID_KEY, makeRowId());
  ydoc.transact(() => yRows.push([row]));
}
