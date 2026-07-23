import type { DataGridRow } from '@toddle-edu/ds-data-grid';
import type { SheetPreviewDto } from '../../../types/api';
import { sortColumnIds } from '../../workspace/sheet/sheetModel';

// Read-only projection of a sheet snapshot for the search preview: reads the plain
// /preview DTO (a Y.Map/Y.Array snapshot flattened by the backend) instead of a live
// Y.Doc, reusing sheetModel's shared ordering/column helpers so the two never drift.

export { buildSheetColumns } from '../../workspace/sheet/sheetModel';

// Column ids in display order for the plain DTO; ordering rule lives in sheetModel.
export function readColumnIds(colTypes: SheetPreviewDto['colTypes']): string[] {
  return sortColumnIds(Object.keys(colTypes), (id) => colTypes[id]);
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
