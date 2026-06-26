import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, IconButton, TextInput } from '@toddle-edu/ds-web';
import {
  LeftArrowOutlined,
  SearchOutlined,
  GlobeOutlined,
  LockOutlined,
  ChevronRightOutlined,
  BellRingOutlined,
  SendOutlined,
} from '@toddle-edu/ds-icons';
import { Icon } from '../../components/Icon';
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
  // Optimistic "just requested here" set — bridges the gap between a successful
  // request and the next poll that reflects it. Cleared per-workspace below once
  // the server reports an authoritative state, so it can never mask a later change.
  const [requested, setRequested] = useState<Set<string>>(new Set());

  // Latest request state per workspace. Sort newest-first ourselves (by createdAt)
  // rather than trusting the server's order, so a stale REJECTED can't shadow a
  // newer PENDING and offer a duplicate "Request again".
  const stateByWorkspace = useMemo(() => {
    const m = new Map<string, JoinRequestState>();
    const byNewest = [...(requests ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const r of byNewest) if (!m.has(r.workspaceId)) m.set(r.workspaceId, r.state);
    return m;
  }, [requests]);

  // Drop the optimistic flag once the server has a state for that workspace — the
  // server is now authoritative (e.g. a later REJECTED must show "Request again",
  // not stay stuck on the optimistic "Awaiting approval").
  useEffect(() => {
    setRequested((prev) => {
      const next = new Set([...prev].filter((id) => !stateByWorkspace.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [stateByWorkspace]);

  // Auto-enter a workspace the moment a request we made *in this session* is approved.
  // `requestedThisSession` is populated only when the user clicks Request here and
  // persists after the optimistic `requested` set is cleared, so we never barge into
  // an approval for a request made elsewhere/earlier (those already show in the launcher).
  const requestedThisSession = useRef<Set<string>>(new Set());
  const entered = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!requests) return;
    const approved = requests.find(
      (r) =>
        r.state === 'APPROVED' &&
        requestedThisSession.current.has(r.workspaceId) &&
        !entered.current.has(r.id),
    );
    if (!approved) return;
    entered.current.add(approved.id);
    pushToast({
      kind: 'success',
      message: `Access granted — opening ${approved.workspace?.name ?? 'workspace'}…`,
    });
    qc.invalidateQueries({ queryKey: qk.workspaces });
    enterWorkspaceScope(qc, approved.workspaceId)
      .then(() => navigate(`/w/${approved.workspaceId}`))
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
        <div className="pb-2">
          <IconButton
            type="plain"
            variant="neutral"
            icon={<LeftArrowOutlined />}
            title="Back"
            onClick={() => navigate('/')}
          />
        </div>
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
          Open a public workspace right away, or request access to a private one
        </p>

        <div className={s.raSearch}>
          <TextInput
            dsVersion="2.0"
            leadingIcon={<SearchOutlined />}
            placeholder="Search workspaces in Toddle…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className={s.raList}>
          {isLoading && <p className="auth-fine">Loading workspaces…</p>}
          {!isLoading && filtered.length === 0 && (
            <p className="auth-fine">No discoverable workspaces right now.</p>
          )}
          {filtered.map((w) => {
            const vis = workspaceVisual(w.id);
            const pub = w.visibility === 'PUBLIC';
            const reqState = stateByWorkspace.get(w.id);
            // Server state wins once known; `requested` only bridges until the next poll.
            const isPending = reqState === 'PENDING' || requested.has(w.id);
            const isRejected = reqState === 'REJECTED';
            const VisIcon = pub ? GlobeOutlined : LockOutlined;
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
                  <VisIcon size="xxxx-small" overrideVariantStyles className="ic" />
                  {pub ? 'Public' : 'Private'}
                </span>
                {pub ? (
                  <Button
                    variant="primary"
                    type="fill"
                    size="small"
                    rightIcon={<ChevronRightOutlined />}
                    disabled={joinPublic.isPending}
                    onClick={() => joinPublic.mutate(w.id)}
                  >
                    Open
                  </Button>
                ) : isPending ? (
                  <Button
                    variant="neutral"
                    type="outlined"
                    size="small"
                    disabled
                    icon={<BellRingOutlined />}
                  >
                    Awaiting approval
                  </Button>
                ) : (
                  <Button
                    variant="neutral"
                    type="outlined"
                    size="small"
                    icon={<SendOutlined />}
                    disabled={requestAccess.isPending}
                    onClick={() =>
                      requestAccess.mutate(
                        { workspaceId: w.id },
                        {
                          onSuccess: () => {
                            requestedThisSession.current.add(w.id);
                            setRequested((prev) => new Set(prev).add(w.id));
                          },
                        },
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
