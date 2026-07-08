import * as Y from 'yjs';
import type {
  DataGridCell,
  DataGridCellEdit,
  DataGridContextMenu,
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
  for (
    let position = index + 1;
    position > 0;
    position = Math.floor((position - 1) / ALPHABET_SIZE)
  ) {
    label = String.fromCodePoint(LETTER_A_CODE + ((position - 1) % ALPHABET_SIZE)) + label;
  }
  return label;
}

// Inverse of indexToColumnId ('A'↔0, 'Z'↔25, 'AA'↔26).
function columnIdToIndex(label: string): number {
  let position = 0;
  for (const letter of label) {
    position = position * ALPHABET_SIZE + (letter.codePointAt(0)! - LETTER_A_CODE + 1);
  }
  return position - 1;
}

// Legacy docs (pre-uuid columns) store just the type string under a letter id with no
// order; derive the order from the letter so ordering math works on those sheets too.
function readColMeta(yColTypes: SheetColTypes, id: string): SheetColMeta | undefined {
  const meta = yColTypes.get(id);
  if (typeof meta === 'string') return { type: meta, order: columnIdToIndex(id) };
  return meta as SheetColMeta | undefined;
}

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
// The same contextMenu config is shared by every cell; its onClick receives the
// clicked cell's coordinates, so no per-cell closure is needed.
export function readSheetRows(
  yRows: SheetRows,
  columnIds: string[],
  isEditable: boolean,
  contextMenu?: DataGridContextMenu,
): DataGridRow[] {
  return yRows.toArray().map((row) => ({
    rowId: row.get(ID_KEY) as string,
    columns: columnIds.map(
      (id): DataGridCell => ({
        cellType: 'text',
        value: (row.get(id) as string | undefined) ?? '',
        isEditable,
        contextMenu,
      }),
    ),
  }));
}

// A single cell's text; an absent key reads as empty, matching readSheetRows.
export function readSheetCell(yRows: SheetRows, rowId: string, colId: string): string {
  return (findRowMap(yRows, rowId)?.get(colId) as string | undefined) ?? '';
}

export function setSheetCell(
  ydoc: Y.Doc,
  yRows: SheetRows,
  rowId: string,
  colId: string,
  value: string,
): void {
  const row = findRowMap(yRows, rowId);
  if (row) ydoc.transact(() => row.set(colId, value));
}

// Clearing removes the key outright (rather than storing '') so the doc holds no
// entry for an empty cell.
export function clearSheetCell(ydoc: Y.Doc, yRows: SheetRows, rowId: string, colId: string): void {
  const row = findRowMap(yRows, rowId);
  if (row) ydoc.transact(() => row.delete(colId));
}

// Seed a brand-new sheet: A–Z text columns + SHEET_ROW_COUNT empty rows. The caller
// guards on "synced && empty" so an existing doc's rows are never duplicated.
export function seedSheet(ydoc: Y.Doc, yRows: SheetRows, yColTypes: SheetColTypes): void {
  ydoc.transact(() => {
    for (let i = 0; i < COLUMN_COUNT; i++)
      yColTypes.set(makeColumnId(), { type: CELL_TYPE, order: i });
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

const findRowIndex = (yRows: SheetRows, rowId: string): number =>
  yRows.toArray().findIndex((row) => row.get(ID_KEY) === rowId);

// Insert one empty row adjacent to the anchor row. The anchor is resolved by id
// against live Yjs state — grid row indexes can be stale under concurrent edits.
// Returns the new row's id, or null if the anchor row no longer exists.
export function insertSheetRow(
  ydoc: Y.Doc,
  yRows: SheetRows,
  anchorRowId: string,
  side: 'above' | 'below',
): string | null {
  const anchorIndex = findRowIndex(yRows, anchorRowId);
  if (anchorIndex === -1) return null;
  const row = new Y.Map<unknown>();
  const rowId = makeRowId();
  row.set(ID_KEY, rowId);
  const insertIndex = side === 'below' ? anchorIndex + 1 : anchorIndex;
  ydoc.transact(() => yRows.insert(insertIndex, [row]));
  return rowId;
}

export function clearSheetRow(ydoc: Y.Doc, yRows: SheetRows, rowId: string): void {
  const row = findRowMap(yRows, rowId);
  if (!row) return;
  // Snapshot the keys first — deleting while iterating the live Y.Map is undefined.
  const contentKeys = [...row.keys()].filter((key) => key !== ID_KEY);
  ydoc.transact(() => {
    for (const key of contentKeys) row.delete(key);
  });
}

// Returns false only when the delete is refused because it would leave the sheet
// with no rows; a row that's already gone counts as done.
export function deleteSheetRow(ydoc: Y.Doc, yRows: SheetRows, rowId: string): boolean {
  if (yRows.length <= 1) return false;
  const index = findRowIndex(yRows, rowId);
  if (index !== -1) ydoc.transact(() => yRows.delete(index, 1));
  return true;
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

// An order that sorts between two neighbours; open-ended at either edge.
function orderBetween(leftOrder: number | undefined, rightOrder: number | undefined): number {
  if (leftOrder == null) return (rightOrder ?? 0) - 1;
  if (rightOrder == null) return leftOrder + 1;
  return (leftOrder + rightOrder) / 2;
}

// Insert a text column beside the anchor column, ordered fractionally between its
// neighbours so no other column's entry is rewritten (concurrent inserts at the same
// spot may share an order — readColumnIds tie-breaks on the id). Returns the new
// column's id, or null if the anchor column no longer exists.
export function insertSheetColumn(
  ydoc: Y.Doc,
  yColTypes: SheetColTypes,
  anchorColId: string,
  side: 'left' | 'right',
): string | null {
  const ids = readColumnIds(yColTypes);
  const anchorIndex = ids.indexOf(anchorColId);
  if (anchorIndex === -1) return null;
  const leftIndex = side === 'left' ? anchorIndex - 1 : anchorIndex;
  const orderOf = (id: string | undefined) =>
    id == null ? undefined : readColMeta(yColTypes, id)?.order;
  const order = orderBetween(orderOf(ids[leftIndex]), orderOf(ids[leftIndex + 1]));
  const id = makeColumnId();
  ydoc.transact(() => yColTypes.set(id, { type: CELL_TYPE, order }));
  return id;
}

// Clearing a column deletes its key from every row; the column itself stays.
export function clearSheetColumn(ydoc: Y.Doc, yRows: SheetRows, colId: string): void {
  ydoc.transact(() => {
    for (const row of yRows.toArray()) row.delete(colId);
  });
}

// Returns false only when the delete is refused because it would leave the sheet
// with no columns; a column that's already gone counts as done. Also drops the
// column's values from every row so no orphaned data lingers in the doc.
export function deleteSheetColumn(
  ydoc: Y.Doc,
  yColTypes: SheetColTypes,
  yRows: SheetRows,
  colId: string,
): boolean {
  if (yColTypes.size <= 1) return false;
  if (!yColTypes.has(colId)) return true;
  ydoc.transact(() => {
    yColTypes.delete(colId);
    for (const row of yRows.toArray()) row.delete(colId);
  });
  return true;
}
