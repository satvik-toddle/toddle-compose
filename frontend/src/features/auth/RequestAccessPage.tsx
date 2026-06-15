import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { TextInput } from '../../components/TextInput';
import { useDiscoverableWorkspaces } from '../../hooks/queries';
import { useJoinPublicWorkspace, useRequestAccess } from '../../hooks/useJoinRequestMutations';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { performLogout } from '../../lib/session';
import { useAuthStore } from '../../stores/authStore';
import { cn } from '../../lib/cn';

export function RequestAccessPage() {
  const me = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: workspaces = [], isLoading } = useDiscoverableWorkspaces();
  const joinPublic = useJoinPublicWorkspace();
  const requestAccess = useRequestAccess();
  const [query, setQuery] = useState('');
  const [requested, setRequested] = useState<Set<string>>(new Set());

  const filtered = useMemo(
    () => workspaces.filter((w) => w.name.toLowerCase().includes(query.toLowerCase())),
    [workspaces, query],
  );

  const signOut = async () => {
    await performLogout(qc);
    navigate('/login');
  };

  return (
    <div className="rbac auth-bg">
      <div className="auth-card ra-card">
        <div className="auth-brand">
          <div className="auth-logo">
            <img src="/brand/ToddleLogo.svg" alt="" />
          </div>
          <div className="auth-word">
            Toddle <span>Compose</span>
          </div>
        </div>
        <h1 className="auth-h">Find a workspace to join</h1>
        <p className="auth-p">
          Open a public workspace right away, or request access to a private one — an admin will
          approve it.
        </p>

        <TextInput
          wrapClassName="ra-search"
          icon="SearchOutlined"
          placeholder="Search workspaces in Toddle…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className="ra-list">
          {isLoading && <p className="auth-fine">Loading workspaces…</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="auth-fine">No discoverable workspaces right now.</p>
          )}
          {filtered.map((w) => {
            const vis = workspaceVisual(w.id);
            const pub = w.visibility === 'PUBLIC';
            const isRequested = requested.has(w.id);
            return (
              <div key={w.id} className="ra-row">
                <span
                  className="ws-emoji sm"
                  style={{ background: vis.color + '22', boxShadow: `inset 0 0 0 1px ${vis.color}44` }}
                >
                  <Icon name={vis.icon} size={18} style={{ color: vis.color }} />
                </span>
                <div className="ra-info">
                  <div className="nm">{w.name}</div>
                  <div className="sub">{pub ? 'Anyone in the realm can join' : 'Approval required'}</div>
                </div>
                <span className={cn('ra-vis', pub ? 'pub' : 'priv')}>
                  <Icon name={pub ? 'GlobeOutlined' : 'LockOutlined'} size={12} />
                  {pub ? 'Public' : 'Private'}
                </span>
                {pub ? (
                  <Button
                    variant="primary"
                    size="sm"
                    iconRight="ChevronRightOutlined"
                    disabled={joinPublic.isPending}
                    onClick={() => joinPublic.mutate(w.id)}
                  >
                    Open
                  </Button>
                ) : isRequested ? (
                  <Button size="sm" disabled className="ra-requested" icon="TickSmallOutlined">
                    Requested
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    icon="SendOutlined"
                    disabled={requestAccess.isPending}
                    onClick={() =>
                      requestAccess.mutate(
                        { workspaceId: w.id },
                        { onSuccess: () => setRequested((s) => new Set(s).add(w.id)) },
                      )
                    }
                  >
                    Request access
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <p className="auth-fine">
          Don't see your team's workspace? Ask a realm admin to add you directly.
        </p>
      </div>
      <div className="auth-foot">
        {me && (
          <>
            Signed in as <b style={{ color: 'var(--text-primary)' }}>{me.email}</b> ·{' '}
          </>
        )}
        <a onClick={signOut} role="button">
          Sign out
        </a>
      </div>
    </div>
  );
}
