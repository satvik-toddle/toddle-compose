import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, TextInput, Tag } from '@toddle-edu/ds-web';
import { EmailOutlined, GlobeOutlined, AddOutlined, TickSmallOutlined } from '@toddle-edu/ds-icons';
import { useRealm } from '../../hooks/queries';
import { useUpdateRealmSettings } from '../../hooks/useRealmMutations';
import { PageLoader } from '../../components/Loader';

const styles = {
  page: 'flex-1 overflow-auto px-[30px] pt-[26px] pb-10',
  pageWrap: 'mx-auto max-w-[1040px]',
  pageHead: 'mb-5 flex items-end justify-between gap-[18px]',
  pageTitle: 'm-0 text-[25px] font-extrabold tracking-[-0.01em]',
  pageSubtitle: 'mt-1 text-[13px] text-secondary',
  card: 'flex max-w-[640px] flex-col gap-4 rounded-3 border border-[var(--line)] bg-[var(--panel-bg)] px-5 py-[18px]',
  cardHeader: 'flex items-start gap-2.5',
  cardTitle: 'text-[14px] font-semibold',
  cardSubtitle: 'mt-0.5 text-[12px] text-secondary',
  addRow: 'flex items-center gap-2',
  addInput: 'flex-1',
  chips: 'flex flex-wrap gap-2',
  emptyHint: 'text-[13px] text-secondary',
  actions: 'flex justify-end gap-2 border-t border-[var(--line)] pt-3.5',
};

// Bare lowercase host, "@"/whitespace stripped (mirrors the backend normaliser).
function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, '');
}

// Order-insensitive equality of two domain lists (treats them as sets).
const sameDomainSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

export function RealmSettingsTab() {
  const { data: realm, isLoading } = useRealm();
  const saveSettings = useUpdateRealmSettings();
  const isOwner = realm?.role === 'OWNER';

  const savedDomains = useMemo(
    () => realm?.allowedEmailDomains ?? [],
    [realm?.allowedEmailDomains],
  );
  const [editedDomains, setEditedDomains] = useState<string[]>([]);
  const [domainInput, setDomainInput] = useState('');

  // Sync from the server while the user has no unsaved edits. A background refetch must not
  // wipe edits, but must still pick up the real allowlist if the first payload was empty/stale.
  const lastSyncedDomains = useRef<string[] | null>(null);
  useEffect(() => {
    if (!realm) return;
    const hasLocalEdits =
      lastSyncedDomains.current !== null && !sameDomainSet(editedDomains, lastSyncedDomains.current);
    if (hasLocalEdits) return;
    setEditedDomains(savedDomains);
    lastSyncedDomains.current = savedDomains;
  }, [realm, savedDomains, editedDomains]);

  const hasUnsavedChanges = !sameDomainSet(editedDomains, savedDomains);

  // Centralised so additional states (e.g. validating) can be added here later.
  const saveButtonLabel = useMemo(() => {
    if (saveSettings.isPending) return 'Saving…';
    return 'Save changes';
  }, [saveSettings.isPending]);

  const addDomain = () => {
    const updatedDomains = new Set(editedDomains);
    for (const entry of domainInput.split(',')) {
      const domain = normalizeDomain(entry);
      if (domain) updatedDomains.add(domain);
    }
    setEditedDomains([...updatedDomains]);
    setDomainInput('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addDomain();
    }
  };

  if (isLoading)
    return (
      <div className={styles.page}>
        <div className={styles.pageWrap}>
          <PageLoader />
        </div>
      </div>
    );

  return (
    <div className={styles.page}>
      <div className={styles.pageWrap}>
        <div className={styles.pageHead}>
          <div>
            <h1 className={styles.pageTitle}>Realm settings</h1>
            <div className={styles.pageSubtitle}>
              {isOwner
                ? 'Restrict who can sign up by allowing only specific email domains.'
                : 'Only the realm owner can change these settings.'}
            </div>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <EmailOutlined size="xxx-small" variant="subtle" className="ic" />
            <div>
              <div className={styles.cardTitle}>Allowed email domains</div>
              <div className={styles.cardSubtitle}>
                New sign-ups must use one of these domains. Leave empty to allow any email.
              </div>
            </div>
          </div>

          {isOwner && (
            <div className={styles.addRow}>
              <div className={styles.addInput}>
                <TextInput
                  dsVersion="2.0"
                  leadingIcon={<GlobeOutlined />}
                  placeholder="toddleapp.com"
                  value={domainInput}
                  onChange={(e) => setDomainInput(e.target.value)}
                  onKeyDown={onKeyDown}
                />
              </div>
              <Button
                variant="neutral"
                type="outlined"
                icon={<AddOutlined />}
                disabled={!normalizeDomain(domainInput)}
                onClick={addDomain}
              >
                Add domain
              </Button>
            </div>
          )}

          <div className={styles.chips}>
            {editedDomains.length === 0 && (
              <span className={styles.emptyHint}>Any email domain can register.</span>
            )}
            {editedDomains.map((domain) => (
              <Tag
                key={domain}
                color="neutral"
                size="small"
                onClose={
                  isOwner
                    ? () => setEditedDomains((current) => current.filter((d) => d !== domain))
                    : undefined
                }
              >
                @{domain}
              </Tag>
            ))}
          </div>

          {isOwner && (
            <div className={styles.actions}>
              <Button
                variant="neutral"
                type="plain"
                disabled={!hasUnsavedChanges || saveSettings.isPending}
                onClick={() => setEditedDomains(savedDomains)}
              >
                Reset
              </Button>
              <Button
                variant="primary"
                type="fill"
                icon={<TickSmallOutlined />}
                disabled={!hasUnsavedChanges || saveSettings.isPending}
                onClick={() => saveSettings.mutate({ allowedEmailDomains: editedDomains })}
              >
                {saveButtonLabel}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
