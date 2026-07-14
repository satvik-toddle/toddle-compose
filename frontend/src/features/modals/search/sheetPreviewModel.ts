import type { DataGridHeader, DataGridRow } from '@toddle-edu/ds-data-grid';
import type { SheetPreviewDto } from '../../../types/api';
import { indexToColumnId } from '../../workspace/sheet/sheetModel';

// Read-only mirror of sheetModel's Yjs helpers, but reading the plain /preview DTO
// (a Y.Map/Y.Array snapshot flattened by the backend) instead of a live Y.Doc.

const ALPHABET_SIZE = 26;
const LETTER_A_CODE = 'A'.codePointAt(0)!;
const COLUMN_WIDTH = 160;

// Inverse of indexToColumnId; mirrors sheetModel's private helper so legacy string
// colTypes (no `.order`) still sort by their letter id.
function columnIdToIndex(label: string): number {
  let position = 0;
  for (const letter of label) {
    position = position * ALPHABET_SIZE + (letter.codePointAt(0)! - LETTER_A_CODE + 1);
  }
  return position - 1;
}

// A column's display order: `.order` from its {type, order} meta, or (for a legacy
// string colType) derived from the letter id — matching sheetModel.readColumnIds.
function colOrder(colTypes: SheetPreviewDto['colTypes'], id: string): number {
  const meta = colTypes[id];
  if (typeof meta === 'string') return columnIdToIndex(id);
  const order = (meta as { order?: unknown } | null | undefined)?.order;
  return typeof order === 'number' ? order : 0;
}

// Column ids in display order (mirror of sheetModel.readColumnIds for the plain DTO).
export function readColumnIds(colTypes: SheetPreviewDto['colTypes']): string[] {
  return Object.keys(colTypes).sort(
    (a, b) => colOrder(colTypes, a) - colOrder(colTypes, b) || a.localeCompare(b),
  );
}

// Header per column: opaque id, letter label for its position (mirror of buildSheetColumns).
export function buildSheetColumns(columnIds: string[]): DataGridHeader[] {
  return columnIds.map((id, index) => ({
    id,
    title: indexToColumnId(index),
    width: COLUMN_WIDTH,
    styles: { align: 'center' },
  }));
}

// Read-only grid rows from the snapshot (mirror of readSheetRows). A row with no id
// gets a stable index-based fallback; an absent cell key reads as empty.
export function buildSheetRows(sheet: SheetPreviewDto, columnIds: string[]): DataGridRow[] {
  return sheet.rows.map((row, index) => ({
    rowId: row.rowId ?? `row-${index}`,
    columns: columnIds.map((id) => ({
      cellType: 'text' as const,
      value: row.values[id] ?? '',
      isEditable: false,
    })),
  }));
}
