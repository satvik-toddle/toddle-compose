import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { TextInput } from '../../components/TextInput';
import { useDiscoverableWorkspaces, useMyJoinRequests } from '../../hooks/queries';
import { useJoinPublicWorkspace, useRequestAccess } from '../../hooks/useJoinRequestMutations';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { performLogout, enterWorkspaceScope } from '../../lib/session';
import { qk } from '../../lib/queryKeys';
import { useAuthStore } from '../../stores/authStore';
import { pushToast } from '../../stores/uiStore';
import { cn } from '../../lib/cn';
import type { JoinRequestState } from '../../types/roles';
import s from './RequestAccessPage.module.scss';

export function RequestAccessPage() {
  const me = useAuthStore((s) => s.user);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: workspaces = [], isLoading } = useDiscoverableWorkspaces();
  const { data: requests } = useMyJoinRequests();
  const joinPublic = useJoinPublicWorkspace();
  const requestAccess = useRequestAccess();
  const [query, setQuery] = useState('');
  const [requested, setRequested] = useState<Set<string>>(new Set());

  // Latest request state per workspace (requests arrive newest-first).
  const stateByWorkspace = useMemo(() => {
    const m = new Map<string, JoinRequestState>();
    for (const r of requests ?? []) if (!m.has(r.workspaceId)) m.set(r.workspaceId, r.state);
    return m;
  }, [requests]);

  // Enter a workspace when a request we watched go PENDING here is then approved by an
  // admin. Gating on "seen pending this session" avoids barging in on a stale approval
  // (e.g. one already granted before the page loaded — that workspace is in the launcher).
  const seenPending = useRef<Set<string>>(new Set());
  const handled = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!requests) return;
    for (const r of requests) if (r.state === 'PENDING') seenPending.current.add(r.id);
    const granted = requests.find(
      (r) => r.state === 'APPROVED' && seenPending.current.has(r.id) && !handled.current.has(r.id),
    );
    if (!granted) return;
    handled.current.add(granted.id);
    pushToast({ kind: 'success', message: `Access granted — opening ${granted.workspace?.name ?? 'workspace'}…` });
    qc.invalidateQueries({ queryKey: qk.workspaces });
    enterWorkspaceScope(qc, granted.workspaceId)
      .then(() => navigate(`/w/${granted.workspaceId}`))
      .catch(() => navigate('/launcher'));
  }, [requests, qc, navigate]);

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
          wrapClassName={s.raSearch}
          icon="SearchOutlined"
          placeholder="Search workspaces in Toddle…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <div className={s.raList}>
          {isLoading && <p className="auth-fine">Loading workspaces…</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="auth-fine">No discoverable workspaces right now.</p>
          )}
          {filtered.map((w) => {
            const vis = workspaceVisual(w.id);
            const pub = w.visibility === 'PUBLIC';
            const reqState = stateByWorkspace.get(w.id);
            const isPending = requested.has(w.id) || reqState === 'PENDING';
            const isRejected = reqState === 'REJECTED' && !requested.has(w.id);
            return (
              <div key={w.id} className={s.raRow}>
                <span
                  className="ws-emoji sm"
                  style={{ background: vis.color + '22', boxShadow: `inset 0 0 0 1px ${vis.color}44` }}
                >
                  <Icon name={vis.icon} size={18} style={{ color: vis.color }} />
                </span>
                <div className={s.raInfo}>
                  <div className="nm">{w.name}</div>
                  <div className="sub">
                    {pub
                      ? 'Anyone in the realm can join'
                      : isRejected
                        ? 'Request declined — you can ask again'
                        : 'Approval required'}
                  </div>
                </div>
                <span className={cn(s.raVis, pub ? s.pub : s.priv)}>
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
                ) : isPending ? (
                  <Button size="sm" disabled className="ra-requested" icon="BellRingOutlined">
                    Awaiting approval
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
                    {isRejected ? 'Request again' : 'Request access'}
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
