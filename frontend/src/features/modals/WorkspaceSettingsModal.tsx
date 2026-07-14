import { useState } from 'react';
import type { ReactElement } from 'react';
import { Alert, Badge, Button as DsButton, SearchInput, Table, Tooltip } from '@toddle-edu/ds-web';
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
import { AddWorkspaceMemberModal } from './AddWorkspaceMemberModal';
import { ConfirmRemoveMemberModal } from './ConfirmRemoveMemberModal';
import { RenameWorkspaceModal } from './RenameWorkspaceModal';
import { WorkspaceAccessTokensTab } from './WorkspaceAccessTokensTab';
import { useRealm, useWorkspace, useWorkspaceMembers, useWorkspaceJoinRequests } from '../../hooks/queries';
import { useSetWorkspaceMemberRole } from '../../hooks/useWorkspaceMemberMutations';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { WS_ROLE_OPTIONS, isRealmAdmin } from '../../lib/roles';
import { formatDate } from '../../lib/time';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { cn } from '../../lib/cn';
import type { WorkspaceMember } from '../../types/api';
import type { WorkspaceRole } from '../../types/roles';

type SettingsTab = 'general' | 'members' | 'requests' | 'accessTokens' | 'danger';
type NavIcon =
  | 'SettingsOutlined'
  | 'MultipleUsersOutlined'
  | 'BellRingOutlined'
  | 'KeyDiagonalOutlined';
type RemoveTarget = { userId: string; name: string; email: string; role: WorkspaceRole };
// Child dialogs rendered locally (stacked over this modal) so settings survives.
type Child = 'addMember' | 'rename' | { kind: 'removeMember'; member: RemoveTarget };

// ds Table row cells mirror PagesListView's PageRow (no null/boolean ReactNode members).
type MemberRow = {
  id: string;
  rowData: { key: string; value: string | number | ReactElement | undefined }[];
};

const MEMBER_HEADERS = [
  { key: 'person', value: 'Person' },
  { key: 'role', value: 'Workspace role' },
  { key: 'remove', value: 'Remove' },
];

const styles = {
  wsHead: 'flex items-center gap-2.75 px-[18px] pb-4 pt-[18px]',
  wsName: 'truncate text-body font-bold leading-tight',
  wsSub: 'mt-0.5 text-body-s text-secondary',
  sectionLabel: 'px-5 pb-1.5 pt-1 text-label-xs uppercase text-secondary',
  dangerLabel: 'px-2.5 pb-1.5 pt-1 text-label-xs uppercase text-secondary',
  navList: 'flex flex-col gap-0.5 px-2.5',
  dangerZone: 'mt-auto px-2.5 pb-3 pt-3',
  bar: 'flex items-center gap-3 border-b border-secondary px-5.5 py-4',
  barTitle: 'text-heading-6 text-primary',
  barDesc: 'mt-1 text-body-s text-secondary',
  scroll: 'min-h-0 flex-1 overflow-auto px-5.5 py-5',
  group: 'flex flex-col gap-[18px]',
  idCard:
    'flex items-center gap-3 rounded-3 border border-secondary bg-surface-secondary-enabled px-4 py-3.5',
  idName: 'truncate text-body font-semibold',
  idSub: 'text-body-s text-secondary',
  statRow: 'flex gap-3',
  statCard:
    'flex-1 rounded-[11px] border border-secondary bg-surface-secondary-enabled px-4 py-3.5',
  statKey: 'text-label-xs font-semibold text-secondary',
  statVal: 'mt-1 font-bold tracking-tight',
  memToolbar: 'mb-3.5 flex items-center gap-2',
  memTableWrap: 'min-h-0 overflow-auto border border-secondary rounded-2', // Bordered scroll area under the fixed header.
  navItem: 'hover:bg-surface-secondary-hover hover:text-primary',
  navItemActive: 'bg-surface-secondary-hover text-primary',
  navDangerText: 'text-semantic-error'
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
  const { data: ws } = useWorkspace(workspaceId);
  const { data: members, isLoading: membersLoading } = useWorkspaceMembers(workspaceId, isAdmin);
  const { data: requests, isLoading: requestsLoading } = useWorkspaceJoinRequests(
    workspaceId,
    isAdmin,
  );

  // Prefer the live query over the prop frozen at open time, so an in-modal rename shows immediately.
  const name = ws?.name ?? workspaceName;
  const memberCount = members?.length ?? 0;
  const requestCount = requests?.length ?? 0;
  const closeChild = () => setChild(null);

  const nav: { id: SettingsTab; icon: NavIcon; label: string; count?: number; alert?: boolean }[] =
    [
      { id: 'general', icon: 'SettingsOutlined', label: 'General' },
      ...(isAdmin
        ? ([
            { id: 'members', icon: 'MultipleUsersOutlined', label: 'Members', count: memberCount },
            {
              id: 'requests',
              icon: 'BellRingOutlined',
              label: 'Requests',
              count: requestCount,
              alert: requestCount > 0,
            },
            { id: 'accessTokens', icon: 'KeyDiagonalOutlined', label: 'Access tokens' },
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
    accessTokens: {
      h: 'Access tokens',
      d: 'Programmatic access to this workspace. Only admins can create tokens.',
    },
    danger: { h: 'Danger zone', d: 'Irreversible actions for this workspace.' },
  };

  const sidebar = (
    <>
      <div className={styles.wsHead}>
        <WorkspaceBadge id={workspaceId} size={38} iconSize={18} />
        <div className="min-w-0">
          <div className={styles.wsName}>{name}</div>
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
          <DsButton
            variant="neutral"
            type="plain"
            size="medium"
            isFullWidth
            isActivated={tab === 'danger'}
            onClick={() => setTab('danger')}
            icon={<Icon name="DeleteOutlined" size={16} red />}
            rightIcon={<span aria-hidden />}
            className={cn(tab === 'danger' ? styles.navItemActive : null)}
          >
            <span className={styles.navDangerText}>Delete workspace</span>
          </DsButton>
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
              workspaceName={name}
              isAdmin={isAdmin}
              memberCount={memberCount}
              requestCount={requestCount}
              onRename={() => setChild('rename')}
            />
          )}
          {tab === 'members' && isAdmin && (
            <MembersTab
              workspaceId={workspaceId}
              members={members}
              isLoading={membersLoading}
              onAdd={() => setChild('addMember')}
              onRemove={(member) => setChild({ kind: 'removeMember', member })}
            />
          )}
          {tab === 'requests' && isAdmin && (
            <RequestsTable
              requests={requests ?? []}
              isLoading={requestsLoading}
              emptyText={`When someone asks to join ${name}, it'll show up here.`}
            />
          )}
          {tab === 'accessTokens' && isAdmin && (
            <WorkspaceAccessTokensTab workspaceId={workspaceId} />
          )}
          {tab === 'danger' && isAdmin && (
            <DangerPanel workspaceId={workspaceId} workspaceName={name} memberCount={memberCount} />
          )}
        </div>
      </ModalWithSideBar>

      {child === 'addMember' && (
        <AddWorkspaceMemberModal
          onClose={closeChild}
          workspaceId={workspaceId}
          workspaceName={name}
        />
      )}
      {child === 'rename' && (
        <RenameWorkspaceModal
          onClose={closeChild}
          workspaceId={workspaceId}
          name={name}
          icon={workspaceVisual(workspaceId).icon}
        />
      )}
      {typeof child === 'object' && child?.kind === 'removeMember' && (
        <ConfirmRemoveMemberModal
          onClose={closeChild}
          scope="workspace"
          workspaceId={workspaceId}
          workspaceName={name}
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
    <DsButton
      className={cn(styles.navItem, active ? styles.navItemActive : null)}
      variant="neutral"
      type="plain"
      size="medium"
      isFullWidth
      isActivated={active}
      onClick={onClick}
      icon={<Icon name={icon} size={16} muted={!active} />}
      rightIcon={
        count != null ? (
          <Badge
            dsVersion="2.0"
            type="numeric"
            variant={alert ? 'notifications' : 'subtle'}
            size="xxx-small"
            value={count}
            showZero
          />
        ) : (
          <span aria-hidden />
        )
      }
    >
      {label}
    </DsButton>
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
      <div className={cn(styles.statVal, small ? 'text-body' : 'text-heading-4')}>{v}</div>
    </div>
  );
}

function MembersTab({
  workspaceId,
  members,
  isLoading,
  onAdd,
  onRemove,
}: {
  workspaceId: string;
  members: WorkspaceMember[] | undefined;
  isLoading: boolean;
  onAdd: () => void;
  onRemove: (member: RemoveTarget) => void;
}) {
  const me = useAuthStore((s) => s.user);
  const { data: realm } = useRealm();
  const actorIsRealmAdmin = isRealmAdmin(realm?.role);
  const setRole = useSetWorkspaceMemberRole();
  const [query, setQuery] = useState('');

  // Plain workspace admins can't hand out the Admin role — that's realm-admin controlled.
  const roleOptions = actorIsRealmAdmin
    ? WS_ROLE_OPTIONS
    : WS_ROLE_OPTIONS.filter((o) => o.value !== 'ADMIN');

  const list = members ?? [];
  const adminCount = list.filter((m) => m.role === 'ADMIN').length;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? list.filter(
        (m) => m.user.name.toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q),
      )
    : list;

  if (isLoading) return <PageLoader />;

  const rows: MemberRow[] = filtered.map((m) => {
    const isYou = m.userId === me?.id;
    const soleAdmin = m.role === 'ADMIN' && adminCount <= 1;
    // Mirror backend rules 1-3: owner untouchable, maintainer owner-only, ws-admin realm-admin controlled (self exempt).
    const blockedByRealm =
      m.realmRole === 'OWNER' || (m.realmRole === 'MAINTAINER' && realm?.role !== 'OWNER');
    const blockedByAdminRule = !isYou && !actorIsRealmAdmin && m.role === 'ADMIN';
    const manageable = !blockedByRealm && !blockedByAdminRule;
    return {
      id: m.userId,
      rowData: [
        {
          key: 'person',
          value: (
            <PersonCell name={m.user.name} email={m.user.email} color={m.user.color} youTag={isYou} />
          ),
        },
        {
          key: 'role',
          value: (
            <RoleSelect<WorkspaceRole>
              value={m.role}
              // Keep the row's current role listed even when ADMIN isn't offerable, so the select can render it.
              options={roleOptions.some((o) => o.value === m.role) ? roleOptions : [...roleOptions, ...WS_ROLE_OPTIONS.filter((o) => o.value === m.role)]}
              locked={soleAdmin || !manageable}
              onChange={(role) => setRole.mutate({ workspaceId, userId: m.userId, role })}
              renderValue={(r) => <WSChip role={r} />}
            />
          ),
        },
        {
          key: 'remove',
          value: !manageable ? (
            <span aria-hidden />
          ) : soleAdmin ? (
            <Tooltip dsVersion="2.0" placement="top" showArrow tooltip="Can't remove the last admin">
              <span className="inline-flex opacity-40">
                <IconButton icon="DeleteOutlined" red disabled />
              </span>
            </Tooltip>
          ) : (
            <IconButton
              icon="DeleteOutlined"
              red
              title="Remove from workspace"
              onClick={() =>
                onRemove({ userId: m.userId, name: m.user.name, email: m.user.email, role: m.role })
              }
            />
          ),
        },
      ],
    };
  });

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
        <IconButton
          variant="primary"
          type="fill"
          icon="AddOutlined"
          iconSize={16}
          title="Add member"
          onClick={onAdd}
        />
      </div>
      <div className={styles.memTableWrap}>
        <Table dsVersion="2.0" headers={MEMBER_HEADERS} data={rows} isHeaderFixed />
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
    <Alert
      dsVersion="2.0"
      type="error"
      title="Delete this workspace"
      message={`Permanently removes ${workspaceName} and every doc inside it. ${memberCount} ${
        memberCount === 1 ? 'member loses' : 'members lose'
      } access immediately. This can't be undone.`}
      actionElementPosition="right"
      actionElement={
        <Button
          variant="danger"
          size="sm"
          icon="DeleteOutlined"
          onClick={() =>
            openModal({ type: 'confirmDeleteWorkspace', workspaceId, name: workspaceName })
          }
        >
          Delete
        </Button>
      }
    />
  );
}
