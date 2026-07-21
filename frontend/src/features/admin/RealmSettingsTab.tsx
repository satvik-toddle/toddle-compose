import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, TextInput, Tag, ToggleSwitch } from '@toddle-edu/ds-web';
import {
  EmailOutlined,
  GlobeOutlined,
  AddOutlined,
  TickSmallOutlined,
  MultipleUsersOutlined,
} from '@toddle-edu/ds-icons';
import { useRealm } from '../../hooks/queries';
import { useUpdateRealmSettings } from '../../hooks/useRealmMutations';
import { PageLoader } from '../../components/Loader';
import { cn } from '../../lib/cn';
import { adminTabStyles } from './adminTabStyles';

const styles = {
  // Settings is a scrollable form (not a height-filling table), so it keeps its
  // own page/pageWrap; the header block is shared via adminTabStyles.
  page: 'flex-1 overflow-auto px-[30px] pt-[26px] pb-10',
  pageWrap: 'mx-auto max-w-[1040px]',
  card: 'flex max-w-[640px] flex-col gap-4 rounded-3 border border-[var(--line)] bg-[var(--panel-bg)] px-5 py-[18px]',
  cardHeader: 'flex items-start gap-2.5',
  cardTitle: 'text-[14px] font-semibold',
  cardSubtitle: 'mt-0.5 text-[12px] text-secondary',
  addRow: 'flex items-center gap-2',
  addInput: 'flex-1',
  chips: 'flex flex-wrap gap-2',
  emptyHint: 'text-[13px] text-secondary',
  actions: 'flex justify-end gap-2 border-t border-[var(--line)] pt-3.5',
  toggleRow: 'flex items-start gap-2.5',
  toggleText: 'flex-1',
  cardGap: 'mt-4',
};

const JOIN_REQUESTS_TOGGLE_LABEL_ID = 'realm-join-requests-toggle-label';

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

  const savedJoinRequests = realm?.joinRequestsEnabled ?? false;
  const [editedJoinRequests, setEditedJoinRequests] = useState(false);

  // Sync from the server while the user has no unsaved edits. A background refetch must not
  // wipe edits, but must still pick up the real values if the first payload was empty/stale.
  // The refs hold the last server values the form was reconciled with.
  const lastSyncedDomains = useRef<string[] | null>(null);
  const lastSyncedJoinRequests = useRef<boolean | null>(null);
  useEffect(() => {
    if (!realm) return;
    const inSyncWithServer =
      sameDomainSet(editedDomains, savedDomains) && editedJoinRequests === savedJoinRequests;
    const hasLocalEdits =
      (lastSyncedDomains.current !== null &&
        !sameDomainSet(editedDomains, lastSyncedDomains.current)) ||
      (lastSyncedJoinRequests.current !== null &&
        editedJoinRequests !== lastSyncedJoinRequests.current);
    // Once the form matches the server again — first load, a successful save, or another
    // admin making the same change — adopt that as the synced baseline. Without this the
    // refs keep the pre-edit values after a save, so hasLocalEdits stays true forever and
    // later server-side changes never sync in (and Save would clobber them).
    if (inSyncWithServer) {
      lastSyncedDomains.current = savedDomains;
      lastSyncedJoinRequests.current = savedJoinRequests;
      return;
    }
    if (hasLocalEdits) return;
    setEditedDomains(savedDomains);
    setEditedJoinRequests(savedJoinRequests);
    lastSyncedDomains.current = savedDomains;
    lastSyncedJoinRequests.current = savedJoinRequests;
  }, [realm, savedDomains, savedJoinRequests, editedDomains, editedJoinRequests]);

  const hasUnsavedChanges =
    !sameDomainSet(editedDomains, savedDomains) || editedJoinRequests !== savedJoinRequests;

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
        <div className={adminTabStyles.pageHead}>
          <div>
            <h1 className={adminTabStyles.h1}>Realm settings</h1>
            <div className={adminTabStyles.headSub}>
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
                onClick={() => {
                  setEditedDomains(savedDomains);
                  setEditedJoinRequests(savedJoinRequests);
                }}
              >
                Reset
              </Button>
              <Button
                variant="primary"
                type="fill"
                icon={<TickSmallOutlined />}
                disabled={!hasUnsavedChanges || saveSettings.isPending}
                onClick={() =>
                  saveSettings.mutate({
                    allowedEmailDomains: editedDomains,
                    joinRequestsEnabled: editedJoinRequests,
                  })
                }
              >
                {saveButtonLabel}
              </Button>
            </div>
          )}
        </div>

        <div className={cn(styles.card, styles.cardGap)}>
          <div className={styles.toggleRow}>
            <MultipleUsersOutlined size="xxx-small" variant="subtle" className="ic" />
            <div className={styles.toggleText}>
              <div id={JOIN_REQUESTS_TOGGLE_LABEL_ID} className={styles.cardTitle}>
                Enable request to join organisation
              </div>
              <div className={styles.cardSubtitle}>
                Let people ask to join this organisation. Approve a request to add them as a member.
              </div>
            </div>
            <ToggleSwitch
              dsVersion="2.0"
              size="medium"
              aria-labelledby={JOIN_REQUESTS_TOGGLE_LABEL_ID}
              checked={editedJoinRequests}
              disabled={!isOwner}
              onChange={(e) => setEditedJoinRequests(e.target.checked)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
