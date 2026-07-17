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
import { AuthShell } from './AuthShell';
import {
  useDiscoverableWorkspaces,
  useMyJoinRequests,
  useMyOrgRequest,
  useRealm,
} from '../../hooks/queries';
import { useJoinPublicWorkspace, useRequestAccess } from '../../hooks/useJoinRequestMutations';
import { useRequestJoinOrg } from '../../hooks/useOrgJoinRequestMutations';
import { useEnterWorkspace } from '../../hooks/useAuthMutations';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { performLogout } from '../../lib/session';
import { qk } from '../../lib/queryKeys';
import { useAuthStore } from '../../stores/authStore';
import { pushToast } from '../../stores/uiStore';
import { cn } from '../../lib/cn';
import type { JoinRequestState } from '../../types/roles';

const styles = {
  // Wider than the default auth card; `!` overrides AuthShell's `.auth-card` width.
  card: '!w-[540px]',
  backButton: 'pb-2',
  heading: 'text-heading-3',
  subheading: 'mt-1.5 mb-4 text-body text-secondary',
  search: 'mb-4 mt-0.5',
  list: 'flex max-h-[400px] flex-col gap-2 overflow-auto pt-2.5',
  hint: 'text-body-s text-secondary',
  footerNote: 'mt-1 text-center text-body-s text-secondary',
  row: 'grid grid-cols-[36px_1fr_auto_auto] items-center gap-3 rounded-3 border border-[var(--line)] bg-[var(--panel-bg)] px-3 py-[11px] hover:border-[var(--border-hover)]',
  icon: 'flex h-9 w-9 min-w-[36px] items-center justify-center rounded-2.5',
  info: 'min-w-0',
  workspaceName: 'text-[14px] font-bold',
  workspaceMeta: 'mt-px text-[12px] text-secondary',
  visibilityBadge:
    'inline-flex h-[22px] items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] text-[11px] font-semibold',
  visibilityBadgePublic:
    'bg-[var(--tag-background-teal-default)] text-[var(--tag-foreground-teal)]',
  visibilityBadgePrivate: 'bg-[var(--surface-tertiary-enabled)] text-secondary [&_.ic]:opacity-60',
  signedInEmail: 'text-primary font-semibold',
  orgCard:
    'mb-4 flex items-center gap-3 rounded-3 border border-[var(--line)] bg-[var(--panel-bg)] px-4 py-[13px]',
  orgInfo: 'min-w-0 flex-1',
  orgTitle: 'text-[14px] font-bold',
  orgMeta: 'mt-px text-[12px] text-secondary',
};

// Labels/subtext for the org-join card mirror the per-workspace helpers below.
function orgStatusText(isPending: boolean, isRejected: boolean): string {
  if (isPending) return 'Your request is awaiting an admin’s approval';
  if (isRejected) return 'Request declined — you can ask again';
  return 'Approval required — an admin adds you as a member';
}

function orgButtonLabel(isRejected: boolean): string {
  if (isRejected) return 'Request again';
  return 'Request to join';
}

// Per-row labels live as pure helpers (a row can't hold its own useMemo).
function workspaceStatusText(isPublicWorkspace: boolean, isRequestRejected: boolean): string {
  if (isPublicWorkspace) return 'Anyone in the realm can join';
  if (isRequestRejected) return 'Request declined — you can ask again';
  return 'Approval required';
}

function requestButtonLabel(isRequestRejected: boolean): string {
  if (isRequestRejected) return 'Request again';
  return 'Request access';
}

export function RequestAccessPage() {
  const currentUser = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: discoverableWorkspaces = [], isLoading } = useDiscoverableWorkspaces();
  const { data: myRequests } = useMyJoinRequests();
  const { data: realm } = useRealm();
  const { data: myOrgRequest } = useMyOrgRequest();
  const joinPublicWorkspace = useJoinPublicWorkspace();
  const requestAccess = useRequestAccess();
  const requestJoinOrg = useRequestJoinOrg();
  const { mutate: enterWorkspace } = useEnterWorkspace();
  const [searchQuery, setSearchQuery] = useState('');
  // Optimistic "just requested here" flags; bridge the gap until the next poll reflects them.
  const [optimisticRequests, setOptimisticRequests] = useState<Set<string>>(new Set());

  // Request state per workspace, sorted newest-first so a stale REJECTED can't shadow a live PENDING.
  const requestStateByWorkspace = useMemo(() => {
    const stateByWorkspace = new Map<string, JoinRequestState>();
    const newestFirst = [...(myRequests ?? [])].sort(
      (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
    for (const request of newestFirst) {
      if (!stateByWorkspace.has(request.workspaceId)) {
        stateByWorkspace.set(request.workspaceId, request.state);
      }
    }
    return stateByWorkspace;
  }, [myRequests]);

  // Once the server reports a state, it's authoritative — drop the optimistic flag.
  useEffect(() => {
    setOptimisticRequests((previous) => {
      const stillOptimistic = new Set(
        [...previous].filter((workspaceId) => !requestStateByWorkspace.has(workspaceId)),
      );
      return stillOptimistic.size === previous.size ? previous : stillOptimistic;
    });
  }, [requestStateByWorkspace]);

  // Auto-enter only workspaces requested in this session (tracked separately so it survives the optimistic flag clearing).
  const requestedThisSession = useRef<Set<string>>(new Set());
  const enteredWorkspaces = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!myRequests) return;
    const approvedRequest = myRequests.find(
      (request) =>
        request.state === 'APPROVED' &&
        requestedThisSession.current.has(request.workspaceId) &&
        !enteredWorkspaces.current.has(request.id),
    );
    if (!approvedRequest) return;
    enteredWorkspaces.current.add(approvedRequest.id);
    pushToast({
      kind: 'success',
      message: `Access granted — opening ${approvedRequest.workspace?.name ?? 'workspace'}…`,
    });
    queryClient.invalidateQueries({ queryKey: qk.workspaces });
    enterWorkspace(approvedRequest.workspaceId, { onError: () => navigate('/launcher') });
  }, [myRequests, queryClient, navigate, enterWorkspace]);

  const matchingWorkspaces = useMemo(
    () =>
      discoverableWorkspaces.filter((workspace) =>
        workspace.name.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [discoverableWorkspaces, searchQuery],
  );

  const signOut = async () => {
    await performLogout(queryClient);
    navigate('/login');
  };

  return (
    <AuthShell
      cardClassName={styles.card}
      lead={
        <div className={styles.backButton}>
          <IconButton
            type="plain"
            variant="neutral"
            icon={<LeftArrowOutlined />}
            title="Back"
            onClick={() => navigate('/')}
          />
        </div>
      }
      foot={
        <>
          {currentUser && (
            <>
              Signed in as <b className={styles.signedInEmail}>{currentUser.email}</b> ·{' '}
            </>
          )}
          <Button variant="progressive" type="inline" size="small" onClick={signOut}>
            Sign out
          </Button>
        </>
      }
    >
      <h1 className={styles.heading}>Find a workspace to join</h1>
      <p className={styles.subheading}>
        Open a public workspace right away, or request access to a private one
      </p>

      {realm?.joinRequestsEnabled &&
        (() => {
          const isPending = myOrgRequest?.state === 'PENDING';
          const isRejected = myOrgRequest?.state === 'REJECTED';
          return (
            <div className={styles.orgCard}>
              <div className={styles.orgInfo}>
                <div className={styles.orgTitle}>Request to join {realm.name}</div>
                <div className={styles.orgMeta}>{orgStatusText(isPending, isRejected)}</div>
              </div>
              {isPending ? (
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
                  variant="primary"
                  type="fill"
                  size="small"
                  icon={<SendOutlined />}
                  disabled={requestJoinOrg.isPending}
                  onClick={() => requestJoinOrg.mutate()}
                >
                  {orgButtonLabel(isRejected)}
                </Button>
              )}
            </div>
          );
        })()}

      <div className={styles.search}>
        <TextInput
          dsVersion="2.0"
          leadingIcon={<SearchOutlined />}
          placeholder="Search workspaces in Toddle…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className={styles.list}>
        {isLoading && <p className={styles.hint}>Loading workspaces…</p>}
        {!isLoading && matchingWorkspaces.length === 0 && (
          <p className={styles.hint}>No discoverable workspaces right now.</p>
        )}
        {matchingWorkspaces.map((workspace) => {
          const appearance = workspaceVisual(workspace.id);
          const isPublicWorkspace = workspace.visibility === 'PUBLIC';
          const requestState = requestStateByWorkspace.get(workspace.id);
          const isRequestPending =
            requestState === 'PENDING' || optimisticRequests.has(workspace.id);
          const isRequestRejected = requestState === 'REJECTED';
          const VisibilityIcon = isPublicWorkspace ? GlobeOutlined : LockOutlined;
          return (
            <div key={workspace.id} className={styles.row}>
              <span
                className={styles.icon}
                style={{ background: `var(--tag-background-${appearance.hue}-default)` }}
              >
                <Icon
                  name={appearance.icon}
                  size={18}
                  style={{ color: `var(--tag-foreground-${appearance.hue})` }}
                />
              </span>
              <div className={styles.info}>
                <div className={styles.workspaceName}>{workspace.name}</div>
                <div className={styles.workspaceMeta}>
                  {workspaceStatusText(isPublicWorkspace, isRequestRejected)}
                </div>
              </div>
              <span
                className={cn(
                  styles.visibilityBadge,
                  isPublicWorkspace ? styles.visibilityBadgePublic : styles.visibilityBadgePrivate,
                )}
              >
                <VisibilityIcon size="xxxx-small" overrideVariantStyles className="ic" />
                {isPublicWorkspace ? 'Public' : 'Private'}
              </span>
              {isPublicWorkspace ? (
                <Button
                  variant="primary"
                  type="fill"
                  size="small"
                  rightIcon={<ChevronRightOutlined />}
                  disabled={joinPublicWorkspace.isPending}
                  onClick={() => joinPublicWorkspace.mutate(workspace.id)}
                >
                  Open
                </Button>
              ) : isRequestPending ? (
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
                      { workspaceId: workspace.id },
                      {
                        onSuccess: () => {
                          requestedThisSession.current.add(workspace.id);
                          setOptimisticRequests((previous) =>
                            new Set(previous).add(workspace.id),
                          );
                        },
                      },
                    )
                  }
                >
                  {requestButtonLabel(isRequestRejected)}
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <p className={styles.footerNote}>
        Don't see your team's workspace? Ask a realm admin to add you directly.
      </p>
    </AuthShell>
  );
}
