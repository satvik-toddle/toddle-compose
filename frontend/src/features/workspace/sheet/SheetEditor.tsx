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
  OPTION_SETS_KEY,
  ROWS_KEY,
  appendSheetColumn,
  appendSheetRow,
  applySheetEdits,
  buildSheetColumns,
  formatSelectionRange,
  isOptionSetCellType,
  saveDropdownOptions,
  setSheetCellType,
  setSheetDateTimeVariant,
  sharedDateTimeVariant,
  sharedOptionSetId,
  readColumnIds,
  readSheetRows,
  seedSheet,
  type SheetCellRef,
  type SheetCellType,
  type SheetDateTimeVariant,
  type SheetColTypes,
  type SheetOptionSet,
  type SheetOptionSets,
  type SheetRows,
} from './sheetModel';
import { createSheetCellContextMenu } from './sheetContextMenu';
import { SheetPanel } from './SheetPanel';
import { useSheetPanel } from './useSheetPanel';

const styles = {
  shell: 'flex-1 min-h-0 flex flex-col p-6',
  // Row of [sheet area | docked panel]: the panel takes layout space, so opening it
  // shrinks the grid and keeps every column visible.
  content: 'flex-1 min-h-0 flex',
  // Grid + the right-edge "add column" bar sit side by side; "add row" spans below.
  sheetArea: 'flex-1 min-w-0 flex flex-col',
  gridRow: 'flex flex-1 min-h-0 gap-2',
  // min-w-0 lets the grid shrink in the flex row so the add-column bar stays on screen.
  grid: 'min-h-0 min-w-0 flex-1',
  // Shared quiet-bar look for both add affordances; only the background lifts on hover.
  addBar:
    'flex items-center justify-center rounded-2 border border-secondary text-secondary transition-colors hover:bg-surface-secondary-hover',
  addColBar: 'w-9 shrink-0',
  // mr-11 = add-column bar width (w-9) + gridRow gap-2, so the bar ends with the grid.
  addRowBar: 'h-9 mt-2 mr-11',
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
  const optionSetsRef = useRef<SheetOptionSets | null>(null);
  const gridRef = useRef<DataGridRef>(null);
  // The column being edited when a new row is appended, so focus can drop straight
  // down into the same column of that row once it arrives from Yjs.
  const lastEditColIdRef = useRef<string | number | null>(null);
  const pendingFocusRef = useRef<{ rowId: string; colId: string | number } | null>(null);
  const [rows, setRows] = useState<DataGridRow[]>([]);
  const [columnIds, setColumnIds] = useState<string[]>([]);
  const [optionSets, setOptionSets] = useState<Record<string, SheetOptionSet>>({});
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

  const selectedCellRefs = useMemo(
    (): SheetCellRef[] =>
      selectedCells.map((cell) => ({ rowId: cell.rowId, colId: String(cell.colId) })),
    [selectedCells],
  );

  // The option set shared by the whole selection; null for mixed or brand-new ranges.
  // `rows` is a dep purely to re-read the live yRows after remote changes.
  const selectedOptionSetId = useMemo(() => {
    if (!isOptionSetCellType(selectedCellType) || !rowsRef.current) return null;
    return sharedOptionSetId(rowsRef.current, selectedCellRefs);
  }, [selectedCellType, selectedCellRefs, rows]);

  // The picker variant shared by the whole selection; null for mixed variants.
  // `rows` is a dep purely to re-read the live yRows after remote changes.
  const selectedDateTimeVariant = useMemo(() => {
    if (selectedCellType !== 'dateTime' || !rowsRef.current) return null;
    return sharedDateTimeVariant(rowsRef.current, selectedCellRefs);
  }, [selectedCellType, selectedCellRefs, rows]);

  const onDateTimeVariantChange = (variant: SheetDateTimeVariant) => {
    if (!docRef.current || !rowsRef.current) return;
    setSheetDateTimeVariant(docRef.current, rowsRef.current, selectedCellRefs, variant);
  };

  const onCellTypeChange = (type: SheetCellType) => {
    if (!docRef.current || !rowsRef.current || !optionSetsRef.current) return;
    setSheetCellType(
      docRef.current,
      rowsRef.current,
      optionSetsRef.current,
      selectedCellRefs,
      type,
    );
  };

  const onSaveDropdownOptions = (optionSet: SheetOptionSet) => {
    if (!docRef.current || !rowsRef.current || !optionSetsRef.current) return;
    saveDropdownOptions(
      docRef.current,
      rowsRef.current,
      optionSetsRef.current,
      selectedCellRefs,
      selectedOptionSetId,
      optionSet,
    );
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
    const yOptionSets = ydoc.getMap<unknown>(OPTION_SETS_KEY);
    docRef.current = ydoc;
    rowsRef.current = yRows;
    colTypesRef.current = yColTypes;
    optionSetsRef.current = yOptionSets;

    const cellContextMenu = canEdit
      ? createSheetCellContextMenu(ydoc, yRows, yColTypes, openPanel)
      : undefined;
    const refresh = () => {
      const ids = readColumnIds(yColTypes);
      setColumnIds(ids);
      setRows(readSheetRows(yRows, yOptionSets, ids, canEdit, cellContextMenu));
      setOptionSets(yOptionSets.toJSON());
    };
    yRows.observeDeep(refresh);
    yColTypes.observe(refresh);
    yOptionSets.observe(refresh);

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
      yOptionSets.unobserve(refresh);
      provider.off('sync', onSync);
      provider.destroy();
      ydoc.destroy();
      docRef.current = null;
      rowsRef.current = null;
      colTypesRef.current = null;
      optionSetsRef.current = null;
    };
  }, [docId, canEdit, openPanel]);

  // Focus the appended row/column cell once it lands over Yjs. Deferred a tick:
  // the grid's ref API resolves colIds against internal state synced one render
  // behind `headers`.
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending || !gridRef.current) return;
    if (!rows.some((row) => row.rowId === pending.rowId)) return;

    const timer = window.setTimeout(() => {
      const grid = gridRef.current;
      if (!grid || pendingFocusRef.current !== pending) return;
      pendingFocusRef.current = null;
      grid.scrollTo({ colId: pending.colId, rowId: pending.rowId });
      // Twice: cells() focuses the canvas after selecting, and focusing a
      // never-focused grid auto-selects the top-left cell over ours.
      grid.selection.cells({ cell: [pending.colId, pending.rowId] });
      grid.selection.cells({ cell: [pending.colId, pending.rowId] });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [rows, columnIds]);

  return (
    <div className={styles.shell}>
      <div className={styles.content}>
        <div className={styles.sheetArea}>
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
        </div>
        {canEdit && (
          <SheetPanel
            isOpen={isPanelOpen}
            selectionLabel={selectionLabel}
            cellType={selectedCellType}
            onCellTypeChange={onCellTypeChange}
            dateTimeVariant={selectedDateTimeVariant}
            onDateTimeVariantChange={onDateTimeVariantChange}
            dropdownOptionSetId={selectedOptionSetId}
            dropdownOptionSet={
              selectedOptionSetId ? (optionSets[selectedOptionSetId] ?? null) : null
            }
            onSaveDropdownOptions={onSaveDropdownOptions}
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
