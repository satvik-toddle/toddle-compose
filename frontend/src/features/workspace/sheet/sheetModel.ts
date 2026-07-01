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

export type SheetRows = Y.Array<Y.Map<unknown>>;
export type SheetColTypes = Y.Map<unknown>;

const ALPHABET_SIZE = 26;
const LETTER_A_CODE = 'A'.codePointAt(0)!;

// A column's position ↔ its spreadsheet label (0↔"A", 25↔"Z", 26↔"AA"). Bijective
// base-26 (digits 1..26 = A..Z, no zero), hence the 1-based ±1.
export function indexToColumnId(index: number): string {
  let label = '';
  for (let position = index + 1; position > 0; position = Math.floor((position - 1) / ALPHABET_SIZE)) {
    label = String.fromCodePoint(LETTER_A_CODE + ((position - 1) % ALPHABET_SIZE)) + label;
  }
  return label;
}

function columnIdToIndex(label: string): number {
  let position = 0;
  for (const letter of label) {
    position = position * ALPHABET_SIZE + (letter.codePointAt(0)! - LETTER_A_CODE + 1);
  }
  return position - 1;
}

// Column ids in display order, read from the persisted colTypes map (Y.Map is unordered).
export function readColumnIds(yColTypes: SheetColTypes): string[] {
  return [...yColTypes.keys()].sort((a, b) => columnIdToIndex(a) - columnIdToIndex(b));
}

// Header configs for the grid, one per column id (ids double as titles).
export function buildSheetColumns(columnIds: string[]): DataGridHeader[] {
  return columnIds.map((id) => ({
    id,
    title: id,
    width: COLUMN_WIDTH,
    styles: { align: 'center' },
  }));
}

const makeRowId = (): string => crypto.randomUUID();

const findRowMap = (yRows: SheetRows, rowId: string): Y.Map<unknown> | undefined =>
  yRows.toArray().find((row) => row.get(ID_KEY) === rowId);

// Map the Yjs rows into ds-data-grid rows — one all-text row per Y.Map; a cell whose
// column key is absent reads as an empty string. Cells follow `columnIds` order.
export function readSheetRows(
  yRows: SheetRows,
  columnIds: string[],
  isEditable: boolean,
): DataGridRow[] {
  return yRows.toArray().map((row) => ({
    rowId: row.get(ID_KEY) as string,
    columns: columnIds.map(
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
    for (let i = 0; i < COLUMN_COUNT; i++) yColTypes.set(indexToColumnId(i), 'text');
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
// Returns the new row's id so the caller can move the selection into it.
export function appendSheetRow(ydoc: Y.Doc, yRows: SheetRows): string {
  const row = new Y.Map<unknown>();
  const rowId = makeRowId();
  row.set(ID_KEY, rowId);
  ydoc.transact(() => yRows.push([row]));
  return rowId;
}

// Append one text column after the current last column. Returns its id.
export function appendSheetColumn(ydoc: Y.Doc, yColTypes: SheetColTypes): string {
  const columnIds = readColumnIds(yColTypes);
  const nextIndex = columnIds.length;
  const id = indexToColumnId(nextIndex);
  ydoc.transact(() => yColTypes.set(id, 'text'));
  return id;
}
