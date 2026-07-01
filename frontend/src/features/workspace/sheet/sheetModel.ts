import * as Y from 'yjs';
import type {
  DataGridCell,
  DataGridCellEdit,
  DataGridHeader,
  DataGridRow,
} from '@toddle-edu/ds-data-grid';

// Yjs roots — these names MUST match the rtc-server's extractSheet
// (rtc-server/src/history/versions.service.ts): 'rows' is a Y.Array of per-row
// Y.Map keyed by '__id'; 'colTypes' is a Y.Map of column id -> { type, order }.
// The column id is an opaque uuid (not the letter label), so two clients adding a
// column concurrently can't collide on the same map key; the letter label is derived
// from `order` at render. The server records each value opaquely, so this stays safe.
export const ROWS_KEY = 'rows';
export const COL_TYPE_KEY = 'colTypes';
const ID_KEY = '__id';

const COLUMN_COUNT = 26; // A–Z, Google-Sheets style
const COLUMN_WIDTH = 160;
export const SHEET_ROW_COUNT = 100;
const CELL_TYPE = 'text';

export type SheetRows = Y.Array<Y.Map<unknown>>;
export type SheetColTypes = Y.Map<unknown>;
// One column's persisted metadata: its cell type and its position in the grid.
type SheetColMeta = { type: string; order: number };

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

const readColMeta = (yColTypes: SheetColTypes, id: string): SheetColMeta | undefined =>
  yColTypes.get(id) as SheetColMeta | undefined;

// Column ids in display order. colTypes is an unordered Y.Map, so sort by each column's
// `order`. Concurrent adds can share an order; the unique id breaks the tie so every
// client resolves the same left-to-right order.
export function readColumnIds(yColTypes: SheetColTypes): string[] {
  const orderOf = (id: string) => readColMeta(yColTypes, id)?.order ?? 0;
  return [...yColTypes.keys()].sort((a, b) => orderOf(a) - orderOf(b) || a.localeCompare(b));
}

// Header configs for the grid, one per column id. Ids are opaque uuids; the visible
// title is the spreadsheet letter for the column's position (A, B, … AA).
export function buildSheetColumns(columnIds: string[]): DataGridHeader[] {
  return columnIds.map((id, index) => ({
    id,
    title: indexToColumnId(index),
    width: COLUMN_WIDTH,
    styles: { align: 'center' },
  }));
}

const makeRowId = (): string => crypto.randomUUID();
const makeColumnId = (): string => crypto.randomUUID();

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
    for (let i = 0; i < COLUMN_COUNT; i++) yColTypes.set(makeColumnId(), { type: CELL_TYPE, order: i });
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

// The next column's order: one past the current highest. Two clients adding at once may
// compute the same value — that's fine, readColumnIds tie-breaks on the unique id.
function nextColumnOrder(yColTypes: SheetColTypes): number {
  let maxOrder = -1;
  for (const id of yColTypes.keys()) {
    maxOrder = Math.max(maxOrder, readColMeta(yColTypes, id)?.order ?? 0);
  }
  return maxOrder + 1;
}

// Append one text column after the current last column. Returns its uuid id, which is
// unique per call, so two clients adding a column at once both survive the merge.
export function appendSheetColumn(ydoc: Y.Doc, yColTypes: SheetColTypes): string {
  const id = makeColumnId();
  const order = nextColumnOrder(yColTypes);
  ydoc.transact(() => yColTypes.set(id, { type: CELL_TYPE, order }));
  return id;
}
