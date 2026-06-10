import { useRef, useState } from 'react';
import { DataGrid } from '@toddle-edu/ds-data-grid';

// First mount of @toddle-edu/ds-data-grid — same linked-package setup as the
// doc-editor (see vite.config.ts + package.json `link:`). For now we just mount
// it with static sample data to confirm the package loads and renders; no
// backend wiring yet. Shape follows the package docs (DataGrid.docs.mdx):
// headers = column config, data = rows of { rowId, columns: [{ value, cellType }] }.

const headers = [
  { id: 'name', title: 'Name', width: 220 },
  { id: 'role', title: 'Role', width: 160 },
  { id: 'score', title: 'Score', width: 120 },
];

const initialData = [
  { rowId: 'r1', columns: [
    { value: 'Alice', cellType: 'text', isEditable: true },
    { value: 'Owner', cellType: 'text', isEditable: true },
    { value: 92, cellType: 'number', isEditable: true },
  ] },
  { rowId: 'r2', columns: [
    { value: 'Bob', cellType: 'text', isEditable: true },
    { value: 'Editor', cellType: 'text', isEditable: true },
    { value: 78, cellType: 'number', isEditable: true },
  ] },
  { rowId: 'r3', columns: [
    { value: 'Carol', cellType: 'text', isEditable: true },
    { value: 'Viewer', cellType: 'text', isEditable: true },
    { value: 64, cellType: 'number', isEditable: true },
  ] },
];

export function DataGridView({ onBack }: { onBack: () => void }) {
  const gridRef = useRef<any>(null);
  const [data, setData] = useState(initialData);

  const onCellEdit = ({ rowId, colId, value }: { rowId: string; colId: string; value: unknown }) => {
    setData((rows) =>
      rows.map((row) =>
        row.rowId !== rowId
          ? row
          : {
              ...row,
              columns: row.columns.map((col, i) =>
                headers[i]?.id === colId ? { ...col, value: value as never } : col,
              ),
            },
      ),
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="row" style={{ justifyContent: 'space-between', borderBottom: '1px solid #e9e9e7', paddingBottom: 8, marginBottom: 8 }}>
        <div className="row">
          <button onClick={onBack}>← Back</button>
          <strong style={{ fontSize: 16 }}>Data Grid</strong>
        </div>
        <span className="tag">ds-data-grid</span>
      </div>
      <div style={{ flex: 1, minHeight: 360 }}>
        <DataGrid
          ref={gridRef}
          headers={headers}
          data={data}
          rowHeight={44}
          dataGridHeight={500}
          dataGridWidth="100%"
          onCellEdit={onCellEdit}
        />
      </div>
    </div>
  );
}
