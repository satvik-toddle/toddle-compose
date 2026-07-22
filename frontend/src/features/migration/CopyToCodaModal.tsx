import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Checkbox,
  SegmentControl,
  SelectDropdown,
  SpinnerLoader,
  Table,
  TextInput,
  Tooltip,
} from '@toddle-edu/ds-web';
import { CloseCircleOutlined, TickCircleOutlined } from '@toddle-edu/ds-icons';
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
  useValidateDestination,
} from '../../hooks/useMigrations';
import { messageOf } from '../../lib/errors';
import { pushToast } from '../../stores/uiStore';
import type { MigrationPlanItemInput } from '../../types/api';

// react-select's union type drops props we set (value/onChange); use it untyped,
// matching the other SelectDropdown call sites (RoleSelect, DocPermissionsModal).
const Select = SelectDropdown as unknown as ComponentType<Record<string, unknown>>;

// "create" makes a fresh Coda page per row (no links); "update" retargets rows
// onto existing Coda pages via their per-row destination link.
type Mode = 'create' | 'update';

interface RowState {
  include: boolean;
  overrideUrl: string; // the row's destination link (prefilled from mapping, editable)
  touched: boolean; // user edited/cleared the link, so stop re-seeding from the mapping
}

// Per-row link-verification state on Start (update mode); absent = idle.
type RowVerify = { status: 'verifying' | 'ok' | 'error'; reason?: string };

const MODE_OPTIONS = [
  { value: 'create', label: 'Create new' },
  { value: 'update', label: 'Update existing' },
];

const UPDATE_HEADERS = [
  { key: 'name', value: 'Page name' },
  { key: 'link', value: 'Link' },
  { key: 'status', value: '' },
];

// Compact per-row Start status: spinner while verifying, tick/cross once resolved.
function RowStatus({ state }: Readonly<{ state?: RowVerify }>) {
  if (!state) return null;
  if (state.status === 'verifying') {
    return <SpinnerLoader size="xxx-small" variant="default" />;
  }
  if (state.status === 'ok') {
    return <TickCircleOutlined size="xx-small" variant="success" />;
  }
  const reason = state.reason ?? 'Invalid link';
  return (
    <Tooltip dsVersion="2.0" placement="top" showArrow tooltip={reason}>
      <span role="img" aria-label={reason} className="inline-flex items-center">
        <CloseCircleOutlined size="xx-small" variant="critical" />
      </span>
    </Tooltip>
  );
}

const styles = {
  side: 'flex h-full flex-col gap-4 px-4 py-4',
  sideHead: 'text-heading-6 text-primary',
  sideSub: 'mt-1 text-body text-secondary',
  label: 'mb-1.5 text-label uppercase text-secondary',
  section: 'flex flex-col',
  foot: 'mt-auto flex flex-col gap-2',
  empty: 'rounded-3 border border-secondary bg-surface-secondary-enabled px-3.5 py-3 text-body text-secondary',
  bar: 'flex items-center gap-3 border-b border-secondary px-5.5 py-4',
  barTitle: 'text-heading-6 text-primary',
  barDesc: 'mt-0.5 truncate text-body text-secondary',
  scroll: 'min-h-0 flex-1 overflow-auto px-3.5 py-3',
  treeHint: 'mb-2 px-1.5 text-body text-secondary',
  tableWrap: 'min-h-0 overflow-auto rounded-2 border border-secondary',
  nameCell: 'block truncate text-body text-primary',
  linkCell: 'min-w-[260px]',
  statusCell: 'flex w-6 items-center justify-center',
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
  const [rowVerify, setRowVerify] = useState<Record<string, RowVerify>>({});
  const [verifying, setVerifying] = useState(false);
  const seededFor = useRef<string | null>(null);

  // Seed the editable tree + per-row state once the workspace docs have loaded.
  useEffect(() => {
    if (docsLoading || seededFor.current === docId) return;
    seededFor.current = docId;
    setItems(seed.items);
    setRows(
      Object.fromEntries(
        seed.items.map((i) => [i.id, { include: true, overrideUrl: '', touched: false }]),
      ),
    );
  }, [docId, docsLoading, seed]);

  // Auto-select the destination (single, or the first) once scopes load, so
  // Update-existing prefill can fetch saved links without a manual pick.
  useEffect(() => {
    if (scopeId === null && scopes && scopes.length > 0) setScopeId(scopes[0].id);
  }, [scopes, scopeId]);

  const isIncluded = (id: string): boolean => rows[id]?.include ?? true;

  // Create-mode inclusion (root is always in); drives the create-mode Start gate.
  const includedIds = useMemo(
    () => items.filter((i) => i.id === docId || isIncluded(i.id)).map((i) => i.id),
    [items, rows, docId],
  );
  // Update-mode inclusion (root is a normal, uncheckable-allowed row).
  const checkedIds = useMemo(
    () => items.filter((i) => isIncluded(i.id)).map((i) => i.id),
    [items, rows],
  );

  // Update mode prefills every row, so request mappings for all item ids there;
  // create mode has no links, so the fetched set is irrelevant.
  const mappingQueryIds = useMemo(
    () => (mode === 'update' ? items.map((i) => i.id) : includedIds),
    [mode, items, includedIds],
  );
  const { data: mappings } = useMigrationMappings(scopeId ?? undefined, mappingQueryIds);
  const mappingUrl = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of mappings ?? []) m.set(row.sourceDocId, row.codaPageUrl);
    return m;
  }, [mappings]);

  // Prefill each untouched row's link from its saved mapping (Update-existing
  // only), so previously migrated rows show their Coda URL. User edits/clears win.
  useEffect(() => {
    if (mode !== 'update' || mappingUrl.size === 0) return;
    setRows((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [id, url] of mappingUrl) {
        const row = prev[id];
        if (row && !row.touched && !row.overrideUrl && url) {
          next[id] = { ...row, overrideUrl: url };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [mode, mappingUrl]);

  // A row's destination link. Only "Update existing" has links; "Create new"
  // always makes a fresh page (no destinationUrl), regardless of any row state.
  const effectiveUrl = (id: string): string =>
    mode === 'update' ? (rows[id]?.overrideUrl.trim() ?? '') : '';

  const patchRow = (id: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // Clears both the enqueue-failure highlighting and any stale per-row ticks/crosses,
  // so an edit/mode/scope/checkbox change never leaves a lingering verify result.
  const clearErrors = () => {
    setErrorMsg(null);
    setInvalidIds(new Set());
    setRowVerify({});
  };

  const enqueue = useEnqueueMigration(scopeId ?? '');
  const validate = useValidateDestination(scopeId ?? '');
  const hasScopes = (scopes?.length ?? 0) > 0;

  // Update mode: at least one checked row and every checked row carries a link.
  const updateValid =
    checkedIds.length > 0 && checkedIds.every((id) => effectiveUrl(id) !== '');
  const canStart =
    !!scopeId &&
    !enqueue.isPending &&
    !verifying &&
    (mode === 'create' ? includedIds.length > 0 : updateValid);

  const scopeOptions = useMemo(
    () => (scopes ?? []).map((s) => ({ value: s.id, label: s.label })),
    [scopes],
  );

  // Build the plan snapshot and enqueue (unchanged behavior; shared by both modes).
  const runEnqueue = () => {
    if (!scopeId) return;
    const planItems: MigrationPlanItemInput[] = items.map((i) => {
      // Create: root force-included, no links. Update: pure checkbox, checked rows carry links.
      const include = mode === 'create' ? i.id === docId || isIncluded(i.id) : isIncluded(i.id);
      const url = effectiveUrl(i.id);
      return {
        sourceDocId: i.id,
        plannedParentDocId: i.parentId,
        title: i.title,
        include,
        ...(include && url ? { destinationUrl: url } : {}),
      };
    });
    // The enqueue root must be a checked item: create always keeps root; update
    // falls back to the first checked row when the root itself is unchecked.
    const sourceRootDocId =
      mode === 'create' || isIncluded(docId)
        ? docId
        : (items.find((i) => isIncluded(i.id))?.id ?? docId);
    enqueue.mutate(
      { items: planItems, sourceRootDocId },
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

  // Update mode: verify every checked row's link CONCURRENTLY, each spinner flipping
  // to a tick/cross independently as it resolves. Only when all pass do we enqueue.
  // The backend rate limiter serializes the underlying Coda reads, so firing one
  // request per row never exceeds Coda's read budget (no client-side fan-out bypass).
  const startUpdate = async () => {
    const ids = checkedIds;
    setRowVerify(Object.fromEntries(ids.map((id) => [id, { status: 'verifying' } as RowVerify])));
    setVerifying(true);
    const results = await Promise.all(
      ids.map(async (id) => {
        try {
          const res = await validate.mutateAsync(effectiveUrl(id));
          setRowVerify((prev) => ({
            ...prev,
            [id]: res.ok ? { status: 'ok' } : { status: 'error', reason: res.reason },
          }));
          return res.ok;
        } catch (e) {
          setRowVerify((prev) => ({ ...prev, [id]: { status: 'error', reason: messageOf(e) } }));
          return false;
        }
      }),
    );
    setVerifying(false);
    if (results.every(Boolean)) {
      runEnqueue();
    } else {
      // Leave the ticks/crosses visible; Start re-enables so the user can fix links.
      setErrorMsg('Some destination links are invalid — fix or uncheck them.');
    }
  };

  const start = () => {
    if (!scopeId || enqueue.isPending || verifying) return;
    if (mode === 'update') {
      // Clear prior errors but keep no stale verify state; verify then enqueue.
      setErrorMsg(null);
      setInvalidIds(new Set());
      void startUpdate();
      return;
    }
    clearErrors();
    runEnqueue();
  };

  // Create-mode tree row trailing control: just the include checkbox (root forced).
  const renderRowEnd = (id: string) => {
    const isRoot = id === docId;
    return (
      <Checkbox
        dsVersion="2.0"
        size="small"
        isChecked={isRoot || isIncluded(id)}
        disabled={isRoot}
        aria-label={isRoot ? `Include ${id} (root, always included)` : `Include ${id}`}
        onChange={(e) => patchRow(id, { include: (e.target as HTMLInputElement).checked })}
      />
    );
  };

  // Sync the Table's native checkbox selection back into row include flags.
  const onSelectionChange = (ids: Array<string | number>) => {
    const set = new Set(ids.map(String));
    setRows((prev) => {
      const next = { ...prev };
      for (const i of items) {
        const cur = next[i.id];
        if (cur) next[i.id] = { ...cur, include: set.has(i.id) };
      }
      return next;
    });
    clearErrors();
  };

  const updateTableRows = useMemo(
    () =>
      items.map((i) => {
        const row = rows[i.id] ?? { include: true, overrideUrl: '', touched: false };
        const missingLink = isIncluded(i.id) && effectiveUrl(i.id) === '';
        const error = invalidIds.has(i.id)
          ? 'Invalid link'
          : missingLink
            ? 'Add a link or uncheck'
            : undefined;
        return {
          id: i.id,
          rowData: [
            {
              key: 'name',
              value: (
                <span className={styles.nameCell} title={i.title}>
                  {i.title}
                </span>
              ),
            },
            {
              key: 'link',
              value: (
                <span className={styles.linkCell}>
                  <TextInput
                    dsVersion="2.0"
                    size="small"
                    placeholder="Paste an in-scope Coda URL"
                    value={row.overrideUrl}
                    error={error}
                    onChange={(e) => {
                      patchRow(i.id, { overrideUrl: e.target.value, touched: true });
                      // Editing a link invalidates any prior verify/enqueue result.
                      clearErrors();
                    }}
                    aria-label={`Coda link for ${i.title}`}
                  />
                </span>
              ),
            },
            {
              key: 'status',
              value: (
                <span className={styles.statusCell}>
                  <RowStatus state={rowVerify[i.id]} />
                </span>
              ),
            },
          ],
        };
      }),
    [items, rows, mode, invalidIds, rowVerify],
  );

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
              clearErrors();
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
        <div className={styles.label}>Existing pages</div>
        <SegmentControl
          dsVersion="2.0"
          size="medium"
          width="100%"
          options={MODE_OPTIONS}
          value={mode}
          onChange={(v: string) => {
            setMode(v as Mode);
            clearErrors();
          }}
          aria-label="Create new Coda pages or update existing ones"
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
        <Button variant="primary" icon="ExportOutlined" block disabled={!canStart} onClick={start}>
          {verifying ? 'Verifying…' : enqueue.isPending ? 'Starting…' : 'Start Copy'}
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
        ) : mode === 'update' ? (
          <div className={styles.tableWrap}>
            <Table
              dsVersion="2.0"
              headers={UPDATE_HEADERS}
              data={updateTableRows}
              rowsSelected={checkedIds}
              onRowSelection={onSelectionChange}
              isHeaderFixed
            />
          </div>
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
