import { useState } from 'react';
import { SearchInput } from '@toddle-edu/ds-web';
import { ModalWithSideBar } from '../../components/ModalWithSideBar';
import { Button } from '../../components/Button';
import { Avatar } from '../../components/Avatar';
import { WSChip } from '../../components/WSChip';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { RoleSelect } from '../../components/RoleSelect';
import { PageLoader } from '../../components/Loader';
import { useWorkspace, useWorkspaceMembers, useWorkspaceJoinRequests } from '../../hooks/queries';
import { useSetWorkspaceMemberRole } from '../../hooks/useWorkspaceMemberMutations';
import { useApproveRequest, useRejectRequest } from '../../hooks/useJoinRequestMutations';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { WS_ROLES, WS_ROLE_META } from '../../lib/roles';
import { formatDate, relativeTime } from '../../lib/time';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { cn } from '../../lib/cn';
import type { WorkspaceRole } from '../../types/roles';

const ROLE_OPTIONS = WS_ROLES.map((r) => ({ value: r, label: WS_ROLE_META[r].label }));

type SettingsTab = 'general' | 'members' | 'requests' | 'danger';
type NavIcon = 'SettingsOutlined' | 'MultipleUsersOutlined' | 'BellRingOutlined';

const styles = {
  wsHead: 'flex items-center gap-2.75 px-[18px] pb-4 pt-[18px]',
  wsEmoji: 'flex h-[38px] w-[38px] flex-none items-center justify-center rounded-2.5',
  wsName: 'truncate text-body-s font-bold leading-tight',
  wsSub: 'mt-0.5 text-label-xs text-secondary',
  sectionLabel: 'px-5 pb-1.5 pt-1 text-label-xs uppercase text-secondary',
  dangerLabel: 'px-2.5 pb-1.5 pt-1 text-label-xs uppercase text-secondary',
  navList: 'flex flex-col gap-0.5 px-2.5',
  navItem: 'flex h-9 items-center gap-2.5 rounded-2 px-2.5 text-body-s',
  navItemActive: 'bg-surface-primary-enabled border border-secondary font-semibold',
  navItemIdle: 'border border-transparent hover:bg-surface-tertiary-enabled',
  navLabel: 'flex-1 text-left',
  navCount: 'min-w-[19px] rounded-full px-1.5 text-center text-label-xs font-bold leading-[18px]',
  navCountAlert: 'bg-[var(--red-500)] text-white',
  navCountMuted: 'bg-surface-tertiary-enabled text-secondary',
  dangerZone: 'mt-auto px-2.5 pb-3 pt-3',
  dangerNav: 'flex h-9 w-full items-center gap-2.5 rounded-2 px-2.5 text-body-s text-semantic-error',
  bar: 'flex items-center gap-3 border-b border-secondary px-5.5 py-4',
  barTitle: 'text-[16px] font-bold leading-tight',
  barDesc: 'mt-1 text-body-s text-secondary',
  scroll: 'min-h-0 flex-1 overflow-auto px-5.5 py-5',
  group: 'flex max-w-[560px] flex-col gap-[18px]',
  idCard: 'flex items-center gap-3 rounded-3 border border-secondary bg-surface-secondary-enabled px-4 py-3.5',
  idEmoji: 'flex h-11 w-11 flex-none items-center justify-center rounded-3',
  idName: 'truncate text-body font-semibold',
  idSub: 'text-body-s text-secondary',
  statRow: 'flex gap-3',
  statCard: 'flex-1 rounded-[11px] border border-secondary bg-surface-secondary-enabled px-4 py-3.5',
  statKey: 'text-label-xs font-semibold text-secondary',
  statVal: 'mt-1 font-bold tracking-tight',
  table: 'overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--panel-bg)]',
  thead: 'grid items-center border-b border-[var(--line)] bg-surface-secondary-enabled',
  th: 'px-4 py-[11px] text-[11px] font-bold uppercase tracking-[0.04em] text-secondary',
  trow: 'grid items-center border-b border-[var(--line)] last:border-b-0 hover:bg-surface-secondary-enabled',
  td: 'px-4 py-[13px] text-[13px]',
  tdMuted: 'px-4 py-[13px] text-[12px] text-secondary',
  tdActions: 'flex justify-end gap-[7px] px-4 py-[13px]',
  cellRight: 'text-right',
  cellMain: 'flex items-center gap-2.75',
  nm: 'text-[13px] font-semibold',
  rowSub: 'mt-px text-[12px] text-secondary',
  youTag:
    'ml-1.5 rounded-[5px] bg-[var(--surface-primary-selected)] px-1.5 py-px align-middle text-[10px] font-bold text-[var(--blue-400)]',
  memGrid: 'grid-cols-[2fr_220px_120px]',
  reqGrid: 'grid-cols-[2fr_160px_120px_210px]',
  memSearch: 'mb-3.5 max-w-[320px]',
  blockedWrap: 'group relative inline-flex',
  blockedTip:
    'pointer-events-none absolute right-0 top-[-34px] hidden items-center gap-1.5 whitespace-nowrap rounded-[7px] bg-[var(--neutral-100)] px-2.25 py-1.5 text-label-xs font-semibold text-[var(--neutral-950)] shadow-elevation-2-bottom group-hover:flex',
  emptyWrap: 'text-center',
  emptyTitle: 'text-[15px] font-semibold',
  emptyText: 'mt-1 text-[13px] text-secondary',
  dangerCard:
    'flex items-center gap-4 rounded-3 border border-[var(--red-500)] bg-[var(--surface-semantic-error)] px-[18px] py-4',
  dangerTitle: 'text-body-s font-bold text-semantic-error',
  dangerText: 'mt-1 text-body-s text-secondary',
};

export interface WorkspaceSettingsModalProps {
  onClose: () => void;
  workspaceId: string;
  workspaceName: string;
  isAdmin: boolean;
}

export function WorkspaceSettingsModal({
  onClose,
  workspaceId,
  workspaceName,
  isAdmin,
}: Readonly<WorkspaceSettingsModalProps>) {
  const [tab, setTab] = useState<SettingsTab>('general');
  const { data: members } = useWorkspaceMembers(workspaceId, isAdmin);
  const { data: requests } = useWorkspaceJoinRequests(workspaceId, isAdmin);
  const visual = workspaceVisual(workspaceId);

  const memberCount = members?.length ?? 0;
  const requestCount = requests?.length ?? 0;

  const nav: { id: SettingsTab; icon: NavIcon; label: string; count?: number; alert?: boolean }[] = [
    { id: 'general', icon: 'SettingsOutlined', label: 'General' },
    ...(isAdmin
      ? ([
          { id: 'members', icon: 'MultipleUsersOutlined', label: 'Members', count: memberCount },
          { id: 'requests', icon: 'BellRingOutlined', label: 'Requests', count: requestCount, alert: requestCount > 0 },
        ] as const)
      : []),
  ];

  const HEAD: Record<SettingsTab, { h: string; d: string }> = {
    general: { h: 'General', d: 'Name, icon and where this workspace sits in your realm.' },
    members: {
      h: 'Members',
      d: `${memberCount} ${memberCount === 1 ? 'person' : 'people'} can open this workspace. Set each person's role or remove them.`,
    },
    requests: {
      h: 'Requests',
      d: `${requestCount} ${requestCount === 1 ? 'person is' : 'people are'} waiting to join. Pick a role and approve, or decline.`,
    },
    danger: { h: 'Danger zone', d: 'Irreversible actions for this workspace.' },
  };

  const action =
    tab === 'members' && isAdmin ? (
      <Button
        variant="primary"
        size="sm"
        icon="AddOutlined"
        onClick={() => useUiStore.getState().openModal({ type: 'addWorkspaceMember', workspaceId, workspaceName })}
      >
        Add member
      </Button>
    ) : null;

  const sidebar = (
    <>
      <div className={styles.wsHead}>
        <span
          className={styles.wsEmoji}
          style={{ background: visual.color + '22', boxShadow: `inset 0 0 0 1px ${visual.color}44` }}
        >
          <Icon name={visual.icon} size={18} style={{ color: visual.color }} />
        </span>
        <div className="min-w-0">
          <div className={styles.wsName}>{workspaceName}</div>
          <div className={styles.wsSub}>Workspace settings</div>
        </div>
      </div>

      <div className={styles.sectionLabel}>Manage</div>
      <div className={styles.navList}>
        {nav.map((n) => (
          <NavItem
            key={n.id}
            active={tab === n.id}
            icon={n.icon}
            label={n.label}
            count={n.count}
            alert={n.alert}
            onClick={() => setTab(n.id)}
          />
        ))}
      </div>

      {isAdmin && (
        <div className={styles.dangerZone}>
          <div className={styles.dangerLabel}>Danger zone</div>
          <button
            type="button"
            onClick={() => setTab('danger')}
            className={cn(styles.dangerNav, tab === 'danger' ? styles.navItemActive : styles.navItemIdle)}
          >
            <Icon name="DeleteOutlined" size={16} red />
            <span className={styles.navLabel}>Delete workspace</span>
          </button>
        </div>
      )}
    </>
  );

  return (
    <ModalWithSideBar onClose={onClose} sidebar={sidebar}>
      <div className={styles.bar}>
        <div className="min-w-0 flex-1">
          <h3 className={styles.barTitle}>{HEAD[tab].h}</h3>
          <div className={styles.barDesc}>{HEAD[tab].d}</div>
        </div>
        {action}
        <IconButton icon="CloseOutlined" iconSize={18} onClick={onClose} aria-label="Close" />
      </div>

      <div className={styles.scroll}>
        {tab === 'general' && (
          <GeneralPanel
            workspaceId={workspaceId}
            workspaceName={workspaceName}
            isAdmin={isAdmin}
            memberCount={memberCount}
            requestCount={requestCount}
          />
        )}
        {tab === 'members' && isAdmin && <MembersTab workspaceId={workspaceId} workspaceName={workspaceName} />}
        {tab === 'requests' && isAdmin && <RequestsTab workspaceId={workspaceId} workspaceName={workspaceName} />}
        {tab === 'danger' && isAdmin && (
          <DangerPanel workspaceId={workspaceId} workspaceName={workspaceName} memberCount={memberCount} />
        )}
      </div>
    </ModalWithSideBar>
  );
}

function NavItem({
  active,
  icon,
  label,
  count,
  alert,
  onClick,
}: {
  active: boolean;
  icon: NavIcon;
  label: string;
  count?: number;
  alert?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(styles.navItem, active ? styles.navItemActive : styles.navItemIdle)}
    >
      <Icon name={icon} size={16} muted={!active} />
      <span className={styles.navLabel}>{label}</span>
      {count != null && (
        <span className={cn(styles.navCount, alert ? styles.navCountAlert : styles.navCountMuted)}>{count}</span>
      )}
    </button>
  );
}

function GeneralPanel({
  workspaceId,
  workspaceName,
  isAdmin,
  memberCount,
  requestCount,
}: {
  workspaceId: string;
  workspaceName: string;
  isAdmin: boolean;
  memberCount: number;
  requestCount: number;
}) {
  const { data: ws } = useWorkspace(workspaceId);
  const visual = workspaceVisual(workspaceId);
  const openModal = useUiStore((s) => s.openModal);

  return (
    <div className={styles.group}>
      <div className={styles.idCard}>
        <span
          className={styles.idEmoji}
          style={{ background: visual.color + '22', boxShadow: `inset 0 0 0 1px ${visual.color}44` }}
        >
          <Icon name={visual.icon} size={24} style={{ color: visual.color }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={styles.idName}>{workspaceName}</div>
          {isAdmin && (
            <div className={styles.idSub}>
              {memberCount} {memberCount === 1 ? 'member' : 'members'}
            </div>
          )}
        </div>
        {isAdmin && (
          <Button
            size="sm"
            icon="PencilOutlined"
            onClick={() => openModal({ type: 'renameWorkspace', workspaceId, name: workspaceName, icon: visual.icon })}
          >
            Rename
          </Button>
        )}
      </div>

      <div className={styles.statRow}>
        {isAdmin && <Stat k="Members" v={String(memberCount)} />}
        {isAdmin && <Stat k="Pending requests" v={String(requestCount)} />}
        <Stat k="Created" v={formatDate(ws?.createdAt)} small />
      </div>
    </div>
  );
}

function Stat({ k, v, small }: { k: string; v: string; small?: boolean }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statKey}>{k}</div>
      <div className={cn(styles.statVal, small ? 'text-body' : 'text-[22px]')}>{v}</div>
    </div>
  );
}

function MembersTab({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const me = useAuthStore((s) => s.user);
  const { data: members, isLoading } = useWorkspaceMembers(workspaceId, true);
  const setRole = useSetWorkspaceMemberRole();
  const openModal = useUiStore((s) => s.openModal);
  const [query, setQuery] = useState('');

  const list = members ?? [];
  const adminCount = list.filter((m) => m.role === 'ADMIN').length;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? list.filter((m) => m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q))
    : list;

  if (isLoading) return <PageLoader />;

  return (
    <>
      <div className={styles.memSearch}>
        <SearchInput
          dsVersion="2.0"
          size="small"
          placeholder="Search members…"
          aria-label="Search members"
          onChange={setQuery}
        />
      </div>
      <div className={styles.table}>
        <div className={cn(styles.thead, styles.memGrid)}>
          <div className={styles.th}>Person</div>
          <div className={styles.th}>Workspace role</div>
          <div className={cn(styles.th, styles.cellRight)}>Remove</div>
        </div>
        {filtered.map((m) => {
          const isYou = m.userId === me?.id;
          const soleAdmin = m.role === 'ADMIN' && adminCount <= 1;
          return (
            <div key={m.userId} className={cn(styles.trow, styles.memGrid)}>
              <div className={cn(styles.td, styles.cellMain)}>
                <Avatar person={{ name: m.user.name, color: m.user.color }} size={32} />
                <div>
                  <div className={styles.nm}>
                    {m.user.name} {isYou && <span className={styles.youTag}>You</span>}
                  </div>
                  <div className={styles.rowSub}>{m.user.email}</div>
                </div>
              </div>
              <div className={styles.td}>
                <RoleSelect<WorkspaceRole>
                  value={m.role}
                  options={ROLE_OPTIONS}
                  locked={soleAdmin}
                  onChange={(role) => setRole.mutate({ workspaceId, userId: m.userId, role })}
                  renderValue={(r) => <WSChip role={r} />}
                />
              </div>
              <div className={cn(styles.td, styles.cellRight)}>
                {soleAdmin ? (
                  <span className={styles.blockedWrap}>
                    <IconButton icon="DeleteOutlined" red disabled style={{ opacity: 0.4 }} />
                    <span className={styles.blockedTip}>
                      <Icon name="InformationOutlined" size={12} white />
                      Can't remove the last admin
                    </span>
                  </span>
                ) : (
                  <IconButton
                    icon="DeleteOutlined"
                    red
                    title="Remove from workspace"
                    onClick={() =>
                      openModal({
                        type: 'confirmRemoveMember',
                        scope: 'workspace',
                        workspaceId,
                        workspaceName,
                        userId: m.userId,
                        name: m.user.name,
                        email: m.user.email,
                        role: m.role,
                      })
                    }
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function RequestsTab({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const { data: requests, isLoading } = useWorkspaceJoinRequests(workspaceId, true);
  const approve = useApproveRequest();
  const reject = useRejectRequest();
  const [grant, setGrant] = useState<Record<string, WorkspaceRole>>({});

  const list = requests ?? [];

  if (isLoading) return <PageLoader />;
  if (list.length === 0) {
    return (
      <div className={styles.emptyWrap}>
        <div className={styles.emptyTitle}>No pending requests</div>
        <div className={styles.emptyText}>When someone asks to join {workspaceName}, it'll show up here.</div>
      </div>
    );
  }

  return (
    <div className={styles.table}>
      <div className={cn(styles.thead, styles.reqGrid)}>
        <div className={styles.th}>Person</div>
        <div className={styles.th}>Grant role</div>
        <div className={styles.th}>Requested</div>
        <div className={cn(styles.th, styles.cellRight)}>Decision</div>
      </div>
      {list.map((r) => {
        const role = grant[r.id] ?? r.requestedRole;
        return (
          <div key={r.id} className={cn(styles.trow, styles.reqGrid)}>
            <div className={cn(styles.td, styles.cellMain)}>
              <Avatar person={{ name: r.user.name, color: r.user.color }} size={32} />
              <div>
                <div className={styles.nm}>{r.user.name}</div>
                <div className={styles.rowSub}>{r.user.email}</div>
              </div>
            </div>
            <div className={styles.td}>
              <RoleSelect<WorkspaceRole>
                value={role}
                options={ROLE_OPTIONS}
                onChange={(v) => setGrant((g) => ({ ...g, [r.id]: v }))}
                renderValue={(v) => <WSChip role={v} />}
              />
            </div>
            <div className={styles.tdMuted}>{relativeTime(r.createdAt)}</div>
            <div className={styles.tdActions}>
              <Button
                variant="primary"
                size="sm"
                icon="TickSmallOutlined"
                disabled={approve.isPending}
                onClick={() => approve.mutate({ workspaceId, requestId: r.id, role })}
              >
                Approve
              </Button>
              <Button size="sm" disabled={reject.isPending} onClick={() => reject.mutate({ workspaceId, requestId: r.id })}>
                Decline
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DangerPanel({
  workspaceId,
  workspaceName,
  memberCount,
}: {
  workspaceId: string;
  workspaceName: string;
  memberCount: number;
}) {
  const openModal = useUiStore((s) => s.openModal);
  return (
    <div className={styles.dangerCard}>
      <div className="min-w-0 flex-1">
        <div className={styles.dangerTitle}>Delete this workspace</div>
        <div className={styles.dangerText}>
          Permanently removes {workspaceName} and every doc inside it. {memberCount}{' '}
          {memberCount === 1 ? 'member loses' : 'members lose'} access immediately. This can't be undone.
        </div>
      </div>
      <Button
        variant="danger"
        size="sm"
        icon="DeleteOutlined"
        onClick={() => openModal({ type: 'confirmDeleteWorkspace', workspaceId, name: workspaceName })}
      >
        Delete workspace
      </Button>
    </div>
  );
}
