import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, TextInput, Tag } from '@toddle-edu/ds-web';
import { EmailOutlined, GlobeOutlined, AddOutlined, TickSmallOutlined } from '@toddle-edu/ds-icons';
import { useRealm } from '../../hooks/queries';
import { useUpdateRealmSettings } from '../../hooks/useRealmMutations';
import { PageLoader } from '../../components/Loader';

// Bare lowercase host, "@"/whitespace stripped (mirrors the backend normaliser).
function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, '');
}

// Order-insensitive equality of two domain lists (treats them as sets).
const sameDomainSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

export function RealmSettingsTab() {
  const { data: realm, isLoading } = useRealm();
  const update = useUpdateRealmSettings();
  const isOwner = realm?.role === 'OWNER';

  const saved = useMemo(() => realm?.allowedEmailDomains ?? [], [realm?.allowedEmailDomains]);
  const [domains, setDomains] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  // Seed local edits from the server once, when settings first load. We deliberately
  // don't re-seed on every `saved` change: a background refetch must not silently wipe
  // unsaved chip edits. After a successful save `saved` already equals `domains`, and
  // the Reset button re-syncs on demand.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !realm) return;
    setDomains(saved);
    seeded.current = true;
  }, [realm, saved]);

  const dirty = !sameDomainSet(domains, saved);

  const addDraft = () => {
    const next = new Set(domains);
    for (const part of draft.split(',')) {
      const d = normalizeDomain(part);
      if (d) next.add(d);
    }
    setDomains([...next]);
    setDraft('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addDraft();
    }
  };

  if (isLoading)
    return (
      <div className="page">
        <div className="page-wrap">
          <PageLoader />
        </div>
      </div>
    );

  return (
    <div className="page">
      <div className="page-wrap">
        <div className="page-head">
          <div>
            <h1>Realm settings</h1>
            <div className="sub">
              {isOwner
                ? 'Restrict who can sign up by allowing only specific email domains.'
                : 'Only the realm owner can change these settings.'}
            </div>
          </div>
        </div>

        <div className="flex max-w-[640px] flex-col gap-4 rounded-3 border border-[var(--line)] bg-[var(--panel-bg)] px-5 py-[18px]">
          <div className="flex items-start gap-2.5">
            <EmailOutlined size="xxx-small" variant="subtle" className="ic" />
            <div>
              <div className="text-[14px] font-semibold">Allowed email domains</div>
              <div className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                New sign-ups must use one of these domains. Leave empty to allow any email.
              </div>
            </div>
          </div>

          {isOwner && (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <TextInput
                  dsVersion="2.0"
                  leadingIcon={<GlobeOutlined />}
                  placeholder="toddleapp.com"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={onKeyDown}
                />
              </div>
              <Button
                variant="neutral"
                type="outlined"
                icon={<AddOutlined />}
                disabled={!normalizeDomain(draft)}
                onClick={addDraft}
              >
                Add domain
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {domains.length === 0 && (
              <span className="text-[13px] text-[var(--text-secondary)]">
                Any email domain can register.
              </span>
            )}
            {domains.map((d) => (
              <Tag
                key={d}
                color="neutral"
                size="small"
                onClose={
                  isOwner ? () => setDomains((list) => list.filter((x) => x !== d)) : undefined
                }
              >
                @{d}
              </Tag>
            ))}
          </div>

          {isOwner && (
            <div className="flex justify-end gap-2 border-t border-[var(--line)] pt-3.5">
              <Button
                variant="neutral"
                type="plain"
                disabled={!dirty || update.isPending}
                onClick={() => setDomains(saved)}
              >
                Reset
              </Button>
              <Button
                variant="primary"
                type="fill"
                icon={<TickSmallOutlined />}
                disabled={!dirty || update.isPending}
                onClick={() => update.mutate({ allowedEmailDomains: domains })}
              >
                {update.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
