import { SpinnerLoader } from '@toddle-edu/ds-web';
import { DataGrid } from '@toddle-edu/ds-data-grid';
// The grid's styles (canvas chrome, scrollbars).
import '@toddle-edu/ds-data-grid/dist/main.css';
import type { DocPreviewDto } from '../../../types/api';
import { useDocPreview } from '../../../hooks/useDocSearch';
import { Button } from '../../../components/Button';
import { cn } from '../../../lib/cn';
import { DocEditor } from '../../workspace/DocEditor';
import { buildSheetColumns, buildSheetRows, readColumnIds } from './sheetPreviewModel';

const styles = {
  prev: 'flex-1 min-w-0 flex flex-col bg-surface-secondary-enabled',
  bar: 'flex items-center gap-2.5 h-12.5 flex-none px-[18px] border-b border-solid border-secondary bg-[var(--panel-bg)]',
  barIc: 'flex-none flex items-center justify-center w-7 h-7 rounded-[9px] text-size-200 text-secondary bg-surface-secondary-enabled border border-solid border-secondary',
  meta: 'min-w-0',
  t: 'text-size-100 font-weight-700 truncate',
  p: 'text-size-50 text-secondary truncate',
  gap: 'flex-1',
  grid: 'flex-1 min-h-0 p-2',
  doc: 'flex-1 min-h-0 flex flex-col [&>*]:flex-1 [&>*]:min-h-0',
  placeholder: 'max-w-[600px] mx-auto text-size-100 text-secondary text-center pt-10',
  loading: 'flex flex-col items-center gap-2.5',
};

// Read-only preview: DOC mounts the real collaborative DocEditor (viewOnly) so it renders the
// live content exactly like the page view; SHEET renders a read-only DataGrid from the /preview
// snapshot. Access is enforced server-side by the RTC token / preview endpoint.
export function PreviewPane({
  docId,
  onOpen,
}: {
  docId?: string;
  onOpen: () => void;
}) {
  const { data, isLoading, isError } = useDocPreview(docId, true);

  const path = data?.breadcrumbs
    ?.slice(0, -1)
    .map((b) => b.title)
    .join(' / ');

  return (
    <div className={styles.prev}>
      <div className={styles.bar}>
        <span className={styles.barIc}>{data?.icon || '📄'}</span>
        <div className={styles.meta}>
          <div className={styles.t}>{data?.title ?? 'Preview'}</div>
          {path && <div className={styles.p}>{path}</div>}
        </div>
        <span className={styles.gap} />
        <Button variant="primary" size="sm" iconRight="ChevronRightOutlined" onClick={onOpen}>
          Open doc
        </Button>
      </div>
      <PreviewBody docId={docId} data={data} isLoading={isLoading} isError={isError} />
    </div>
  );
}

function PreviewBody({
  docId,
  data,
  isLoading,
  isError,
}: {
  docId?: string;
  data?: DocPreviewDto;
  isLoading: boolean;
  isError: boolean;
}) {
  if (!docId) return <div className={styles.placeholder}>Select a result</div>;
  if (isLoading)
    return (
      <div className={cn(styles.placeholder, styles.loading)}>
        <SpinnerLoader size="small" />
        <span>Loading preview…</span>
      </div>
    );
  if (isError || !data) return <div className={styles.placeholder}>Couldn&apos;t load preview</div>;

  if (data.type === 'SHEET') {
    const sheet = data.sheet;
    if (!sheet || sheet.rows.length === 0) {
      return <div className={styles.placeholder}>This sheet is empty.</div>;
    }
    const columnIds = readColumnIds(sheet.colTypes);
    return (
      <div className={styles.grid}>
        <DataGrid
          isViewMode
          headers={buildSheetColumns(columnIds)}
          data={buildSheetRows(sheet, columnIds)}
          dataGridHeight="100%"
        />
      </div>
    );
  }

  // DOC: the real collaborative editor, forced read-only — loads live content over RTC.
  // Keyed by docId so switching results remounts on the correct room.
  return (
    <div className={styles.doc}>
      <DocEditor key={docId} docId={docId} viewOnly preview />
    </div>
  );
}
