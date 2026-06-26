import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, IconButton, TextInput, SpinnerLoader } from '@toddle-edu/ds-web';
import {
  EmailOutlined,
  GlobeOutlined,
  AddOutlined,
  CloseOutlined,
  TickSmallOutlined,
} from '@toddle-edu/ds-icons';
import { useRealm } from '../../hooks/queries';
import { useUpdateRealmSettings } from '../../hooks/useRealmMutations';
import s from './RealmSettingsTab.module.scss';

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
          <div className="tc-center">
            <SpinnerLoader size="small" />
          </div>
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

        <div className={s.card}>
          <div className={s.cardHead}>
            <EmailOutlined size="xxx-small" variant="subtle" className="ic" />
            <div>
              <div className={s.cardTitle}>Allowed email domains</div>
              <div className={s.cardSub}>
                New sign-ups must use one of these domains. Leave empty to allow any email.
              </div>
            </div>
          </div>

          {isOwner && (
            <div className={s.addRow}>
              <div className={s.addInput}>
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

          <div className={s.chips}>
            {domains.length === 0 && (
              <span className={s.empty}>Any email domain can register.</span>
            )}
            {domains.map((d) => (
              <span key={d} className={s.chip}>
                @{d}
                {isOwner && (
                  <IconButton
                    type="plain"
                    variant="neutral"
                    size="small"
                    icon={<CloseOutlined />}
                    title={`Remove ${d}`}
                    onClick={() => setDomains((list) => list.filter((x) => x !== d))}
                  />
                )}
              </span>
            ))}
          </div>

          {isOwner && (
            <div className={s.actions}>
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
