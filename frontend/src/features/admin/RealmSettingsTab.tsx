import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { TextInput } from '../../components/TextInput';
import { PageLoader } from '../../components/Loader';
import { useRealm } from '../../hooks/queries';
import { useUpdateRealmSettings } from '../../hooks/useRealmMutations';
import s from './RealmSettingsTab.module.scss';

// Bare lowercase host, "@"/whitespace stripped (mirrors the backend normaliser).
function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, '');
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

export function RealmSettingsTab() {
  const { data: realm, isLoading } = useRealm();
  const update = useUpdateRealmSettings();
  const isOwner = realm?.role === 'OWNER';

  const saved = useMemo(() => realm?.allowedEmailDomains ?? [], [realm?.allowedEmailDomains]);
  const [domains, setDomains] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  // Seed local edits from the server, and re-sync after a successful save.
  useEffect(() => setDomains(saved), [saved]);

  const dirty = !sameSet(domains, saved);

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

  if (isLoading) return <div className="page"><div className="page-wrap"><PageLoader /></div></div>;

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
            <Icon name="EmailOutlined" size={16} muted />
            <div>
              <div className={s.cardTitle}>Allowed email domains</div>
              <div className={s.cardSub}>
                New sign-ups must use one of these domains. Leave empty to allow any email.
              </div>
            </div>
          </div>

          {isOwner && (
            <div className={s.addRow}>
              <TextInput
                wrapClassName={s.addInput}
                icon="GlobeOutlined"
                placeholder="toddleapp.com"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <Button icon="AddOutlined" disabled={!normalizeDomain(draft)} onClick={addDraft}>
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
                    icon="CloseOutlined"
                    title={`Remove ${d}`}
                    onClick={() => setDomains((list) => list.filter((x) => x !== d))}
                  />
                )}
              </span>
            ))}
          </div>

          {isOwner && (
            <div className={s.actions}>
              <Button variant="ghost" disabled={!dirty || update.isPending} onClick={() => setDomains(saved)}>
                Reset
              </Button>
              <Button
                variant="primary"
                icon="TickSmallOutlined"
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
