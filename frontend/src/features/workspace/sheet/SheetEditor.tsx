import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { DataGrid } from '@toddle-edu/ds-data-grid';
// The grid's styles (canvas chrome, inline editor, scrollbars).
import '@toddle-edu/ds-data-grid/dist/main.css';
import type { DataGridCellEdit, DataGridRef, DataGridRow } from '@toddle-edu/ds-data-grid';
import { AddOutlined } from '@toddle-edu/ds-icons';
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
  readColumnIds,
  readSheetRows,
  seedSheet,
  type SheetColTypes,
  type SheetRows,
} from './sheetModel';

const styles = {
  shell: 'flex-1 min-h-0 flex flex-col p-6',
  // Grid + the right-edge "add column" bar sit side by side; "add row" spans below.
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

    const refresh = () => {
      const ids = readColumnIds(yColTypes);
      setColumnIds(ids);
      setRows(readSheetRows(yRows, ids, canEdit));
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
  }, [docId, canEdit]);

  // Focus the appended row/column cell once it lands over Yjs — delayed so the grid has
  // registered a just-added column (scroll/select no-op until it's in the grid's index map).
  useEffect(() => {
    const pending = pendingFocusRef.current;
    const grid = gridRef.current;
    if (!pending || !grid) return;
    if (!rows.some((row) => row.rowId === pending.rowId)) return;
    pendingFocusRef.current = null;

    const timer = setTimeout(() => {
      grid.scrollTo({ colId: pending.colId, rowId: pending.rowId });
      grid.selection.cells({ cell: [pending.colId, pending.rowId] });
    }, 1000);
    return () => clearTimeout(timer);
  }, [rows, columnIds]);

  return (
    <div className={styles.shell}>
      <div className={styles.gridRow}>
        <div className={styles.grid}>
          <DataGrid
            ref={gridRef}
            headers={headers}
            data={rows}
            isViewMode={!canEdit}
            onCellEdit={onCellEdit}
            onAppendRowAtEnd={onAppendRowAtEnd}
            dataGridHeight="100%"
          />
        </div>
        {canEdit && (
          <button
            type="button"
            aria-label="Add column"
            className={cn(styles.addBar, styles.addColBar)}
            onClick={onAddColumn}
          >
            <AddOutlined variant="subtle" />
          </button>
        )}
      </div>
      {canEdit && (
        <button
          type="button"
          aria-label="Add row"
          className={cn(styles.addBar, styles.addRowBar)}
          onClick={onAddRow}
        >
          <AddOutlined variant="subtle" />
        </button>
      )}
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
