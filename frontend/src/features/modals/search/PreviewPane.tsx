import { SpinnerLoader } from '@toddle-edu/ds-web';
import { DataGrid } from '@toddle-edu/ds-data-grid';
// The grid's styles (canvas chrome, scrollbars).
import '@toddle-edu/ds-data-grid/dist/main.css';
import type { DocPreviewDto } from '../../../types/api';
import { useDocPreview } from '../../../hooks/useDocSearch';
import { Button } from '../../../components/Button';
import { DocEditor } from '../../workspace/DocEditor';
import { buildSheetColumns, buildSheetRows, readColumnIds } from './sheetPreviewModel';

// Read-only preview: DOC mounts the real collaborative DocEditor (viewOnly) so it renders the
// live content exactly like the page view; SHEET renders a read-only DataGrid from the /preview
// snapshot. Access is enforced server-side by the RTC token / preview endpoint.
export function PreviewPane({
  docId,
  onOpen,
}: {
  docId?: string;
  q: string;
  onOpen: () => void;
}) {
  const { data, isLoading, isError } = useDocPreview(docId, true);

  const path = data?.breadcrumbs
    ?.slice(0, -1)
    .map((b) => b.title)
    .join(' / ');

  return (
    <div className="gs-prev">
      <div className="gs-prev-bar">
        <span className="sr-ic">{data?.icon || '📄'}</span>
        <div className="pv-meta">
          <div className="t">{data?.title ?? 'Preview'}</div>
          {path && <div className="p">{path}</div>}
        </div>
        <span className="gap" />
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
  if (!docId) return <div className="gs-prev-placeholder">Select a result</div>;
  if (isLoading)
    return (
      <div className="gs-prev-placeholder gs-prev-loading">
        <SpinnerLoader size="small" />
        <span>Loading preview…</span>
      </div>
    );
  if (isError || !data) return <div className="gs-prev-placeholder">Couldn&apos;t load preview</div>;

  if (data.type === 'SHEET') {
    const sheet = data.sheet;
    if (!sheet || sheet.rows.length === 0) {
      return <div className="gs-prev-placeholder">This sheet is empty.</div>;
    }
    const columnIds = readColumnIds(sheet.colTypes);
    return (
      <div className="gs-prev-grid">
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
    <div className="gs-prev-doc">
      <DocEditor key={docId} docId={docId} viewOnly preview />
    </div>
  );
}
