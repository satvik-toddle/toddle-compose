import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Checkbox, SegmentControl, SelectDropdown, TextInput } from '@toddle-edu/ds-web';
import { ModalWithSideBar } from '../../components/ModalWithSideBar';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { PageLoader } from '../../components/Loader';
import { MigrationTree } from './MigrationTree';
import { buildMigrationSeed, type MigrationFlatItem } from './migrationTreeModel';
import { useDocuments } from '../../hooks/usePages';
import {
  useEnqueueMigration,
  useMigrationMappings,
  useMigrationScopes,
} from '../../hooks/useMigrations';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
import { cn } from '../../lib/cn';
import type { MigrationPlanItemInput } from '../../types/api';

// react-select's union type drops props we set (value/onChange); use it untyped,
// matching the other SelectDropdown call sites (RoleSelect, DocPermissionsModal).
const Select = SelectDropdown as unknown as ComponentType<Record<string, unknown>>;

type Mode = 'create' | 'update';

interface RowState {
  include: boolean;
  overrideUrl: string; // manual retarget; wins over the mapping prefill
  editing: boolean;
}

const MODE_OPTIONS = [
  { value: 'create', label: 'Create new' },
  { value: 'update', label: 'Update existing' },
];

const styles = {
  side: 'flex h-full flex-col gap-4 px-4 py-4',
  sideHead: 'text-heading-6 text-primary',
  sideSub: 'mt-1 text-body-s text-secondary',
  label: 'mb-1.5 text-label-xs uppercase text-secondary',
  section: 'flex flex-col',
  foot: 'mt-auto flex flex-col gap-2',
  empty: 'rounded-3 border border-secondary bg-surface-secondary-enabled px-3.5 py-3 text-body-s text-secondary',
  bar: 'flex items-center gap-3 border-b border-secondary px-5.5 py-4',
  barTitle: 'text-heading-6 text-primary',
  barDesc: 'mt-0.5 truncate text-body-s text-secondary',
  scroll: 'min-h-0 flex-1 overflow-auto px-3.5 py-3',
  treeHint: 'mb-2 px-1.5 text-body-s text-secondary',
  dest: 'max-w-[180px] truncate text-body-s text-secondary',
  destSet: 'text-primary',
  destInvalid: 'text-semantic-error',
  editWrap: 'w-[220px]',
};

export function CopyToCodaModal({
  onClose,
  docId,
  workspaceId,
}: Readonly<{ onClose: () => void; docId: string; workspaceId: string }>) {
  const navigate = useNavigate();
  const { data: docs = [], isLoading: docsLoading } = useDocuments(workspaceId);
  const { data: scopes, isLoading: scopesLoading } = useMigrationScopes(workspaceId);

  const seed = useMemo(() => buildMigrationSeed(docs, docId), [docs, docId]);
  const rootDoc = useMemo(() => docs.find((d) => d.id === docId), [docs, docId]);

  const [items, setItems] = useState<MigrationFlatItem[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [scopeId, setScopeId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('create');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [invalidIds, setInvalidIds] = useState<Set<string>>(new Set());
  const seededFor = useRef<string | null>(null);

  // Seed the editable tree + per-row state once the workspace docs have loaded.
  useEffect(() => {
    if (docsLoading || seededFor.current === docId) return;
    seededFor.current = docId;
    setItems(seed.items);
    setRows(
      Object.fromEntries(
        seed.items.map((i) => [i.id, { include: true, overrideUrl: '', editing: false }]),
      ),
    );
  }, [docId, docsLoading, seed]);

  const includedIds = useMemo(
    () => items.filter((i) => rows[i.id]?.include ?? true).map((i) => i.id),
    [items, rows],
  );
  const { data: mappings } = useMigrationMappings(scopeId ?? undefined, includedIds);
  const mappingUrl = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of mappings ?? []) m.set(row.sourceDocId, row.codaPageUrl);
    return m;
  }, [mappings]);

  // A row's destination URL: a manual override wins; otherwise the saved mapping
  // when "Update existing" is selected; else "" (create a new page).
  const effectiveUrl = (id: string): string => {
    const override = rows[id]?.overrideUrl.trim();
    if (override) return override;
    if (mode === 'update') return mappingUrl.get(id) ?? '';
    return '';
  };

  const patchRow = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const enqueue = useEnqueueMigration(scopeId ?? '');
  const hasScopes = (scopes?.length ?? 0) > 0;
  const canStart = !!scopeId && includedIds.length > 0 && !enqueue.isPending;

  const scopeOptions = useMemo(
    () => (scopes ?? []).map((s) => ({ value: s.id, label: s.label })),
    [scopes],
  );

  const start = () => {
    if (!scopeId || enqueue.isPending) return;
    setErrorMsg(null);
    setInvalidIds(new Set());
    const planItems: MigrationPlanItemInput[] = items.map((i) => {
      const url = effectiveUrl(i.id);
      return {
        sourceDocId: i.id,
        plannedParentDocId: i.parentId,
        title: i.title,
        include: rows[i.id]?.include ?? true,
        ...(url ? { destinationUrl: url } : {}),
      };
    });
    enqueue.mutate(
      { items: planItems, sourceRootDocId: docId },
      {
        onSuccess: () => {
          pushToast({ kind: 'success', message: 'Migration started' });
          onClose();
          navigate(`/w/${workspaceId}/migrations`);
        },
        onError: (err) => {
          const msg = messageOf(err);
          setErrorMsg(msg);
          // Flag any row the server names (by its override URL or title).
          const bad = new Set<string>();
          for (const i of items) {
            const url = effectiveUrl(i.id);
            if ((url && msg.includes(url)) || (i.title && msg.includes(i.title))) bad.add(i.id);
          }
          setInvalidIds(bad);
        },
      },
    );
  };

  const renderRowEnd = (id: string) => {
    const row = rows[id] ?? { include: true, overrideUrl: '', editing: false };
    const url = effectiveUrl(id);
    const invalid = invalidIds.has(id);
    return (
      <>
        {row.editing ? (
          <span className={styles.editWrap}>
            <TextInput
              dsVersion="2.0"
              size="small"
              autoFocus
              placeholder="Paste an in-scope Coda URL"
              value={row.overrideUrl}
              onChange={(e) => patchRow(id, { overrideUrl: e.target.value })}
              onBlur={() => patchRow(id, { editing: false })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') patchRow(id, { editing: false });
              }}
            />
          </span>
        ) : (
          <span
            className={cn(styles.dest, url && styles.destSet, invalid && styles.destInvalid)}
            title={url || 'New page'}
          >
            {url || 'New page'}
          </span>
        )}
        <IconButton
          icon="PencilOutlined"
          iconSize={14}
          sm
          aria-label="Override destination URL"
          onClick={() => patchRow(id, { editing: !row.editing })}
        />
        <Checkbox
          dsVersion="2.0"
          size="small"
          isChecked={row.include}
          aria-label={`Include ${id}`}
          onChange={(e) => patchRow(id, { include: (e.target as HTMLInputElement).checked })}
        />
      </>
    );
  };

  const sidebar = (
    <div className={styles.side}>
      <div>
        <div className={styles.sideHead}>Copy to Coda</div>
        <div className={styles.sideSub}>Copy this page and its sub-pages into Coda.</div>
      </div>

      <div className={styles.section}>
        <div className={styles.label}>Destination</div>
        {scopesLoading ? (
          <PageLoader />
        ) : hasScopes ? (
          <Select
            options={scopeOptions}
            value={scopeOptions.find((o) => o.value === scopeId) ?? null}
            onChange={(opt: { value: string } | null) => {
              setScopeId(opt?.value ?? null);
              setErrorMsg(null);
              setInvalidIds(new Set());
            }}
            placeholder="Choose a Coda destination"
            size="small"
            isSearchable={false}
            isClearable={false}
          />
        ) : (
          <div className={styles.empty}>
            No Coda destinations configured. Ask a realm admin to add one in Admin → Migrations.
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.label}>On re-run</div>
        <SegmentControl
          dsVersion="2.0"
          size="medium"
          width="100%"
          options={MODE_OPTIONS}
          value={mode}
          onChange={(v: string) => setMode(v as Mode)}
          aria-label="Create new copies or update existing"
        />
      </div>

      {seed.skippedSheets > 0 && (
        <div className={styles.sideSub}>
          {seed.skippedSheets} {seed.skippedSheets === 1 ? 'sheet' : 'sheets'} skipped (sheets
          can&apos;t be copied to Coda yet).
        </div>
      )}

      {errorMsg && <Alert dsVersion="2.0" type="error" message={errorMsg} />}

      <div className={styles.foot}>
        <Alert
          dsVersion="2.0"
          type="warning"
          message="Copied content leaves toddle's access control and becomes visible to anyone with Coda access."
        />
        <Button variant="primary" icon="ExportOutlined" block disabled={!canStart} onClick={start}>
          {enqueue.isPending ? 'Starting…' : 'Start Copy'}
        </Button>
        <Button variant="ghost" block onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <ModalWithSideBar onClose={onClose} sidebar={sidebar} width="860px">
      <div className={styles.bar}>
        <div className="min-w-0 flex-1">
          <h3 className={styles.barTitle}>Review pages</h3>
          <div className={styles.barDesc}>
            {rootDoc ? rootDoc.title : 'This page'} and its sub-pages
          </div>
        </div>
        <IconButton icon="CloseOutlined" iconSize={18} onClick={onClose} aria-label="Close" />
      </div>
      <div className={styles.scroll}>
        {docsLoading ? (
          <PageLoader />
        ) : items.length === 0 ? (
          <div className={styles.empty}>No pages to copy — this page has no doc content.</div>
        ) : (
          <>
            <div className={styles.treeHint}>
              Drag to reorder or nest. The arrangement here is the hierarchy created in Coda.
            </div>
            <MigrationTree items={items} onItemsChange={setItems} renderRowEnd={renderRowEnd} />
          </>
        )}
      </div>
    </ModalWithSideBar>
  );
}
