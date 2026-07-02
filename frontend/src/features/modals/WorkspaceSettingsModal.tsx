import { useState } from 'react';
import { SearchInput } from '@toddle-edu/ds-web';
import { ModalWithSideBar } from '../../components/ModalWithSideBar';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { WSChip } from '../../components/WSChip';
import { RoleSelect } from '../../components/RoleSelect';
import { PageLoader } from '../../components/Loader';
import { PersonCell } from '../../components/PersonCell';
import { WorkspaceBadge } from '../../components/WorkspaceBadge';
import { RequestsTable } from '../../components/RequestsTable';
import { tableStyles as t } from '../../components/tableStyles';
import { AddWorkspaceMemberModal } from './AddWorkspaceMemberModal';
import { ConfirmRemoveMemberModal } from './ConfirmRemoveMemberModal';
import { RenameWorkspaceModal } from './RenameWorkspaceModal';
import { useWorkspace, useWorkspaceMembers, useWorkspaceJoinRequests } from '../../hooks/queries';
import { useSetWorkspaceMemberRole } from '../../hooks/useWorkspaceMemberMutations';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { WS_ROLES, WS_ROLE_META } from '../../lib/roles';
import { formatDate } from '../../lib/time';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { cn } from '../../lib/cn';
import type { WorkspaceRole } from '../../types/roles';

const ROLE_OPTIONS = WS_ROLES.map((r) => ({ value: r, label: WS_ROLE_META[r].label }));

type SettingsTab = 'general' | 'members' | 'requests' | 'danger';
type NavIcon = 'SettingsOutlined' | 'MultipleUsersOutlined' | 'BellRingOutlined';
type RemoveTarget = { userId: string; name: string; email: string; role: WorkspaceRole };
// Child dialogs rendered locally (stacked over this modal) so settings survives.
type Child = 'addMember' | 'rename' | { kind: 'removeMember'; member: RemoveTarget };

const MEM_GRID = 'grid-cols-[2fr_220px_120px]';

const styles = {
  wsHead: 'flex items-center gap-2.75 px-[18px] pb-4 pt-[18px]',
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
  group: 'flex flex-col gap-[18px]',
  idCard: 'flex items-center gap-3 rounded-3 border border-secondary bg-surface-secondary-enabled px-4 py-3.5',
  idName: 'truncate text-body font-semibold',
  idSub: 'text-body-s text-secondary',
  statRow: 'flex gap-3',
  statCard: 'flex-1 rounded-[11px] border border-secondary bg-surface-secondary-enabled px-4 py-3.5',
  statKey: 'text-label-xs font-semibold text-secondary',
  statVal: 'mt-1 font-bold tracking-tight',
  memToolbar: 'mb-3.5 flex items-center gap-2',
  blockedWrap: 'group relative inline-flex',
  blockedTip:
    'pointer-events-none absolute right-0 top-[-34px] hidden items-center gap-1.5 whitespace-nowrap rounded-[7px] bg-[var(--neutral-100)] px-2.25 py-1.5 text-label-xs font-semibold text-[var(--neutral-950)] shadow-elevation-2-bottom group-hover:flex',
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
  const [child, setChild] = useState<Child | null>(null);
  const { data: members } = useWorkspaceMembers(workspaceId, isAdmin);
  const { data: requests } = useWorkspaceJoinRequests(workspaceId, isAdmin);

  const memberCount = members?.length ?? 0;
  const requestCount = requests?.length ?? 0;
  const closeChild = () => setChild(null);

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

  const sidebar = (
    <>
      <div className={styles.wsHead}>
        <WorkspaceBadge id={workspaceId} size={38} iconSize={18} />
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
    <>
      <ModalWithSideBar onClose={onClose} sidebar={sidebar}>
        <div className={styles.bar}>
          <div className="min-w-0 flex-1">
            <h3 className={styles.barTitle}>{HEAD[tab].h}</h3>
            <div className={styles.barDesc}>{HEAD[tab].d}</div>
          </div>
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
              onRename={() => setChild('rename')}
            />
          )}
          {tab === 'members' && isAdmin && (
            <MembersTab
              workspaceId={workspaceId}
              onAdd={() => setChild('addMember')}
              onRemove={(member) => setChild({ kind: 'removeMember', member })}
            />
          )}
          {tab === 'requests' && isAdmin && (
            <RequestsTable
              requests={requests ?? []}
              emptyText={`When someone asks to join ${workspaceName}, it'll show up here.`}
            />
          )}
          {tab === 'danger' && isAdmin && (
            <DangerPanel workspaceId={workspaceId} workspaceName={workspaceName} memberCount={memberCount} />
          )}
        </div>
      </ModalWithSideBar>

      {child === 'addMember' && (
        <AddWorkspaceMemberModal onClose={closeChild} workspaceId={workspaceId} workspaceName={workspaceName} />
      )}
      {child === 'rename' && (
        <RenameWorkspaceModal
          onClose={closeChild}
          workspaceId={workspaceId}
          name={workspaceName}
          icon={workspaceVisual(workspaceId).icon}
        />
      )}
      {typeof child === 'object' && child?.kind === 'removeMember' && (
        <ConfirmRemoveMemberModal
          onClose={closeChild}
          scope="workspace"
          workspaceId={workspaceId}
          workspaceName={workspaceName}
          userId={child.member.userId}
          name={child.member.name}
          email={child.member.email}
          role={child.member.role}
        />
      )}
    </>
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
  onRename,
}: {
  workspaceId: string;
  workspaceName: string;
  isAdmin: boolean;
  memberCount: number;
  requestCount: number;
  onRename: () => void;
}) {
  const { data: ws } = useWorkspace(workspaceId);

  return (
    <div className={styles.group}>
      <div className={styles.idCard}>
        <WorkspaceBadge id={workspaceId} size={44} iconSize={24} />
        <div className="min-w-0 flex-1">
          <div className={styles.idName}>{workspaceName}</div>
          {isAdmin && (
            <div className={styles.idSub}>
              {memberCount} {memberCount === 1 ? 'member' : 'members'}
            </div>
          )}
        </div>
        {isAdmin && (
          <Button size="sm" icon="PencilOutlined" onClick={onRename}>
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

function MembersTab({
  workspaceId,
  onAdd,
  onRemove,
}: {
  workspaceId: string;
  onAdd: () => void;
  onRemove: (member: RemoveTarget) => void;
}) {
  const me = useAuthStore((s) => s.user);
  const { data: members, isLoading } = useWorkspaceMembers(workspaceId, true);
  const setRole = useSetWorkspaceMemberRole();
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
      <div className={styles.memToolbar}>
        <div className="min-w-0 flex-1">
          <SearchInput
            dsVersion="2.0"
            size="small"
            placeholder="Search members…"
            aria-label="Search members"
            onChange={setQuery}
          />
        </div>
        <IconButton variant="primary" type={"fill"} icon="AddOutlined" iconSize={16} muted={false} title="Add member" onClick={onAdd} />
      </div>
      <div className={t.table}>
        <div className={cn(t.thead, MEM_GRID)}>
          <div className={t.th}>Person</div>
          <div className={t.th}>Workspace role</div>
          <div className={cn(t.th, t.cellRight)}>Remove</div>
        </div>
        {filtered.map((m) => {
          const isYou = m.userId === me?.id;
          const soleAdmin = m.role === 'ADMIN' && adminCount <= 1;
          return (
            <div key={m.userId} className={cn(t.trow, MEM_GRID)}>
              <div className={t.td}>
                <PersonCell name={m.user.name} email={m.user.email} color={m.user.color} youTag={isYou} />
              </div>
              <div className={t.td}>
                <RoleSelect<WorkspaceRole>
                  value={m.role}
                  options={ROLE_OPTIONS}
                  locked={soleAdmin}
                  onChange={(role) => setRole.mutate({ workspaceId, userId: m.userId, role })}
                  renderValue={(r) => <WSChip role={r} />}
                />
              </div>
              <div className={cn(t.td, t.cellRight)}>
                {soleAdmin ? (
                  <span className={styles.blockedWrap}>
                    <span className="opacity-40">
                      <IconButton icon="DeleteOutlined" red disabled />
                    </span>
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
                      onRemove({ userId: m.userId, name: m.user.name, email: m.user.email, role: m.role })
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

function DangerPanel({
  workspaceId,
  workspaceName,
  memberCount,
}: {
  workspaceId: string;
  workspaceName: string;
  memberCount: number;
}) {
  // Delete legitimately ends the session on this workspace, so it navigates away
  // via the global modal store rather than stacking over settings.
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
