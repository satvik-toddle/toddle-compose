import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { DataGrid } from '@toddle-edu/ds-data-grid';
// The grid's styles (canvas chrome, inline editor, scrollbars).
import '@toddle-edu/ds-data-grid/dist/main.css';
import type {
  DataGridCellEdit,
  DataGridRef,
  DataGridRow,
  DataGridSelectedCell,
} from '@toddle-edu/ds-data-grid';
import { AddOutlined } from '@toddle-edu/ds-icons';
import { Tooltip } from '@toddle-edu/ds-web';
import { useRtcToken } from '../../../hooks/usePages';
import { PageLoader } from '../../../components/Loader';
import { RTC_WS_URL } from '../../../lib/env';
import { cn } from '../../../lib/cn';
import {
  COL_TYPE_KEY,
  ROWS_KEY,
  appendSheetColumn,
  appendSheetRow,
  applySheetEdits,
  buildSheetColumns,
  formatSelectionRange,
  setSheetCellType,
  type SheetCellType,
  readColumnIds,
  readSheetRows,
  seedSheet,
  type SheetColTypes,
  type SheetRows,
} from './sheetModel';
import { createSheetCellContextMenu } from './sheetContextMenu';
import { SheetPanel } from './SheetPanel';
import { useSheetPanel } from './useSheetPanel';

const styles = {
  shell: 'flex-1 min-h-0 flex flex-col p-6',
  // Grid + the right-edge "add column" bar sit side by side; "add row" spans below.

  // relative anchors the sheet panel, which overlays the full grid + add-row area.
  content: 'relative flex-1 min-h-0 flex flex-col',
  gridRow: 'flex flex-1 min-h-0 gap-2',
  // min-w-0 lets the grid shrink in the flex row so the add-column bar stays on screen.
  grid: 'min-h-0 min-w-0 flex-1',
  // Shared quiet-bar look for both add affordances; only the background lifts on hover.
  addBar:
    'flex items-center justify-center rounded-2 border border-secondary text-secondary transition-colors hover:bg-surface-secondary-hover',
  addColBar: 'w-9 shrink-0',
  addRowBar: 'h-9 mt-2',
  message: 'flex-1 flex items-center justify-center text-body-s text-secondary',
};

type SheetGridProps = { docId: string; token: string; canEdit: boolean };
type SheetEditorProps = { docId: string };

// Inner grid: owns the Y.Doc + websocket lifecycle for one synced sheet. Mounted only
// once the RTC token is ready, so the provider can connect immediately.
function SheetGrid({ docId, token, canEdit }: Readonly<SheetGridProps>) {
  // y-websocket re-reads params.token on every reconnect; mutating this ref keeps a
  // long-lived session authed with a fresh token without tearing down the live doc.
  const paramsRef = useRef<{ token: string }>({ token });
  paramsRef.current.token = token;

  const docRef = useRef<Y.Doc | null>(null);
  const rowsRef = useRef<SheetRows | null>(null);
  const colTypesRef = useRef<SheetColTypes | null>(null);
  const gridRef = useRef<DataGridRef>(null);
  // The column being edited when a new row is appended, so focus can drop straight
  // down into the same column of that row once it arrives from Yjs.
  const lastEditColIdRef = useRef<string | number | null>(null);
  const pendingFocusRef = useRef<{ rowId: string; colId: string | number } | null>(null);
  const [rows, setRows] = useState<DataGridRow[]>([]);
  const [columnIds, setColumnIds] = useState<string[]>([]);
  const headers = useMemo(() => buildSheetColumns(columnIds), [columnIds]);
  const { isOpen: isPanelOpen, open: openPanel, close: closePanel } = useSheetPanel(canEdit);
  const [selectedCells, setSelectedCells] = useState<DataGridSelectedCell[]>([]);
  const selectionLabel = useMemo(() => formatSelectionRange(selectedCells), [selectedCells]);

  // The shared type of the selected cells, driving the panel's cell-type dropdown.
  const selectedCellType = useMemo((): SheetCellType | 'mixed' | null => {
    if (selectedCells.length === 0) return null;
    const rowsById = new Map(rows.map((row) => [row.rowId, row]));
    const colIndexById = new Map(columnIds.map((id, index) => [id, index]));
    let sharedType: string | null = null;
    for (const cell of selectedCells) {
      const colIndex = colIndexById.get(String(cell.colId));
      const row = rowsById.get(cell.rowId);
      const cellType = (colIndex != null && row?.columns[colIndex]?.cellType) || 'text';
      if (sharedType === null) sharedType = cellType;
      else if (sharedType !== cellType) return 'mixed';
    }
    return sharedType as SheetCellType;
  }, [selectedCells, rows, columnIds]);

  const onCellTypeChange = (type: SheetCellType) => {
    if (!docRef.current || !rowsRef.current) return;
    const cells = selectedCells.map((cell) => ({ rowId: cell.rowId, colId: String(cell.colId) }));
    setSheetCellType(docRef.current, rowsRef.current, cells, type);
  };

  const onCellEdit = (edits: DataGridCellEdit[]) => {
    if (!docRef.current || !rowsRef.current) return;
    const editedColId = edits.at(-1)?.cellCoods.colId;
    if (editedColId != null) lastEditColIdRef.current = editedColId;
    applySheetEdits(docRef.current, rowsRef.current, edits);
  };

  const onAppendRowAtEnd = () => {
    if (!docRef.current || !rowsRef.current) return;
    const newRowId = appendSheetRow(docRef.current, rowsRef.current);
    const colId = lastEditColIdRef.current;
    if (colId != null) pendingFocusRef.current = { rowId: newRowId, colId };
  };

  const onAddRow = () => {
    if (!docRef.current || !rowsRef.current) return;
    const newRowId = appendSheetRow(docRef.current, rowsRef.current);
    const firstColId = columnIds[0];
    if (firstColId != null) pendingFocusRef.current = { rowId: newRowId, colId: firstColId };
  };

  const onAddColumn = () => {
    if (!docRef.current || !colTypesRef.current) return;
    const newColId = appendSheetColumn(docRef.current, colTypesRef.current);
    const firstRowId = rows[0]?.rowId;
    if (firstRowId != null) pendingFocusRef.current = { rowId: firstRowId, colId: newColId };
  };

  useEffect(() => {
    const ydoc = new Y.Doc();
    const yRows = ydoc.getArray<Y.Map<unknown>>(ROWS_KEY);
    const yColTypes = ydoc.getMap<unknown>(COL_TYPE_KEY);
    docRef.current = ydoc;
    rowsRef.current = yRows;
    colTypesRef.current = yColTypes;

    const cellContextMenu = canEdit
      ? createSheetCellContextMenu(ydoc, yRows, yColTypes, openPanel)
      : undefined;
    const refresh = () => {
      const ids = readColumnIds(yColTypes);
      setColumnIds(ids);
      setRows(readSheetRows(yRows, ids, canEdit, cellContextMenu));
    };
    yRows.observeDeep(refresh);
    yColTypes.observe(refresh);

    const provider = new WebsocketProvider(RTC_WS_URL, docId, ydoc, {
      params: paramsRef.current,
      connect: true,
    });

    // Seed the default grid once — only after the server's initial state confirms the
    // sheet is genuinely empty, so an existing doc's rows are never duplicated.
    const onSync = (isSynced: boolean) => {
      if (!isSynced) return;
      if (canEdit && yRows.length === 0) seedSheet(ydoc, yRows, yColTypes);
      refresh();
    };
    provider.on('sync', onSync);
    if (provider.synced) onSync(true);

    return () => {
      yRows.unobserveDeep(refresh);
      yColTypes.unobserve(refresh);
      provider.off('sync', onSync);
      provider.destroy();
      ydoc.destroy();
      docRef.current = null;
      rowsRef.current = null;
      colTypesRef.current = null;
    };
  }, [docId, canEdit, openPanel]);

  // Scroll + select the appended row/column cell once the change lands over Yjs
  // (re-runs on columnIds so a just-added column is in the grid's index map first).
  useEffect(() => {
    const pending = pendingFocusRef.current;
    const grid = gridRef.current;
    if (!pending || !grid) return;
    if (!rows.some((row) => row.rowId === pending.rowId)) return;
    pendingFocusRef.current = null;

    grid.scrollTo({ colId: pending.colId, rowId: pending.rowId });
    grid.selection.cells({ cell: [pending.colId, pending.rowId] });
  }, [rows, columnIds]);

  return (
    <div className={styles.shell}>
      <div className={styles.content}>
        <div className={styles.gridRow}>
          <div className={styles.grid}>
            <DataGrid
              ref={gridRef}
              headers={headers}
              data={rows}
              isViewMode={!canEdit}
              onCellEdit={onCellEdit}
              onCellSelectionChange={setSelectedCells}
              onAppendRowAtEnd={onAppendRowAtEnd}
              dataGridHeight="100%"
            />
          </div>
          {canEdit && (
            <Tooltip dsVersion="2.0" placement="left" showArrow tooltip="Add column">
              <button
                type="button"
                aria-label="Add column"
                className={cn(styles.addBar, styles.addColBar)}
                onClick={onAddColumn}
              >
                <AddOutlined variant="subtle" />
              </button>
            </Tooltip>
          )}
        </div>
        {canEdit && (
          <Tooltip dsVersion="2.0" placement="top" showArrow tooltip="Add row">
            <button
              type="button"
              aria-label="Add row"
              className={cn(styles.addBar, styles.addRowBar)}
              onClick={onAddRow}
            >
              <AddOutlined variant="subtle" />
            </button>
          </Tooltip>
        )}
        {canEdit && (
          <SheetPanel
            isOpen={isPanelOpen}
            selectionLabel={selectionLabel}
            cellType={selectedCellType}
            onCellTypeChange={onCellTypeChange}
            onClose={closePanel}
          />
        )}
      </div>
    </div>
  );
}

// Real-time collaborative sheet (SHEET page type): binds a Yjs rows/colTypes model to
// ds-data-grid. Keyed by docId at the call site; the RTC role drives editability.
export function SheetEditor({ docId }: Readonly<SheetEditorProps>) {
  const { data: rtc, isLoading, isError } = useRtcToken(docId);

  if (isError) {
    return <div className={styles.message}>Couldn&apos;t open this sheet for editing.</div>;
  }

  if (isLoading || !rtc) {
    return (
      <div className={styles.shell}>
        <PageLoader />
      </div>
    );
  }

  return <SheetGrid docId={docId} token={rtc.token} canEdit={rtc.role === 'editor'} />;
}
