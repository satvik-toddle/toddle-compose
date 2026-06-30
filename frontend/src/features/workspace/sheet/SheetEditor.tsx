import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { DataGrid } from '@toddle-edu/ds-data-grid';
// The grid's styles (canvas chrome, inline editor, scrollbars).
import '@toddle-edu/ds-data-grid/dist/main.css';
import type { DataGridCellEdit, DataGridRow } from '@toddle-edu/ds-data-grid';
import { useRtcToken } from '../../../hooks/usePages';
import { PageLoader } from '../../../components/Loader';
import { RTC_WS_URL } from '../../../lib/env';
import {
  COL_TYPE_KEY,
  ROWS_KEY,
  SHEET_COLUMNS,
  appendSheetRow,
  applySheetEdits,
  readSheetRows,
  seedSheet,
  type SheetRows,
} from './sheetModel';

const styles = {
  shell: 'flex-1 min-h-0 flex flex-col p-6',
  grid: 'min-h-0 flex-1',
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
  const [rows, setRows] = useState<DataGridRow[]>([]);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const yRows = ydoc.getArray<Y.Map<unknown>>(ROWS_KEY);
    const yColTypes = ydoc.getMap<unknown>(COL_TYPE_KEY);
    docRef.current = ydoc;
    rowsRef.current = yRows;

    const refresh = () => setRows(readSheetRows(yRows, canEdit));
    yRows.observeDeep(refresh);

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
      provider.off('sync', onSync);
      provider.destroy();
      ydoc.destroy();
      docRef.current = null;
      rowsRef.current = null;
    };
  }, [docId, canEdit]);

  const onCellEdit = (edits: DataGridCellEdit[]) => {
    if (docRef.current && rowsRef.current) applySheetEdits(docRef.current, rowsRef.current, edits);
  };
  const onAppendRowAtEnd = () => {
    if (docRef.current && rowsRef.current) appendSheetRow(docRef.current, rowsRef.current);
  };

  return (
    <div className={styles.shell}>
      <div className={styles.grid}>
        <DataGrid
          headers={SHEET_COLUMNS}
          data={rows}
          isViewMode={!canEdit}
          onCellEdit={onCellEdit}
          onAppendRowAtEnd={onAppendRowAtEnd}
          dataGridHeight="100%"
        />
      </div>
    </div>
  );
}

// Real-time collaborative sheet (the SHEET page type). Mirrors DocEditor's RTC-token
// pattern, but binds a Yjs rows/colTypes model to ds-data-grid instead of Lexical.
// Keyed by docId at the call site → remounts per document; the RTC role drives editability.
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
