import { Button } from '../../components/Button';
import { Avatar } from '../../components/Avatar';
import { WSChip } from '../../components/WSChip';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { RoleSelect } from '../../components/RoleSelect';
import { EmptyState } from '../../components/EmptyState';
import { PageLoader } from '../../components/Loader';
import { useWorkspaceMembers } from '../../hooks/queries';
import { useSetWorkspaceMemberRole } from '../../hooks/useWorkspaceMemberMutations';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { WS_ROLES, WS_ROLE_META } from '../../lib/roles';
import { useWorkspaceCtx } from './WorkspaceLayout';
import s from './MembersPanel.module.scss';
import type { WorkspaceRole } from '../../types/roles';

const ROLE_OPTIONS = WS_ROLES.map((r) => ({ value: r, label: WS_ROLE_META[r].label }));

export function MembersPanel() {
  const ctx = useWorkspaceCtx();
  const me = useAuthStore((s) => s.user);
  const { data: members, isLoading } = useWorkspaceMembers(ctx.workspaceId, ctx.isAdmin);
  const setRole = useSetWorkspaceMemberRole();
  const openModal = useUiStore((s) => s.openModal);

  if (!ctx.isAdmin) {
    return (
      <main className="ws-main">
        <div className="ws-crumbbar">
          <div className="ws-crumbs">
            <span>{ctx.name}</span>
            <span className="sep">/</span>
            <span className="cur">👥 Members</span>
          </div>
        </div>
        <div className="ws-scroll" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <EmptyState glyph={<Icon name="LockOutlined" size={24} muted style={{ width: 36, height: 36 }} />} title="Members are managed by admins">
            Only workspace admins can manage members here.
          </EmptyState>
        </div>
      </main>
    );
  }

  const list = members ?? [];
  const adminCount = list.filter((m) => m.role === 'ADMIN').length;

  return (
    <main className="ws-main">
      <div className="ws-crumbbar">
        <div className="ws-crumbs">
          <span>{ctx.name}</span>
          <span className="sep">/</span>
          <span className="cur">👥 Members</span>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon="AddOutlined"
          onClick={() =>
            openModal({ type: 'addWorkspaceMember', workspaceId: ctx.workspaceId, workspaceName: ctx.name })
          }
        >
          Add member
        </Button>
      </div>
      <div className="ws-scroll">
        <div className="ws-folder-head">
          <span className="ws-emoji" style={{ background: 'var(--surface-tertiary-enabled)' }}>
            👥
          </span>
          <div>
            <h1>Members</h1>
            <div className="sub">
              {list.length} {list.length === 1 ? 'person' : 'people'} in {ctx.name} · you manage roles &amp; access here
            </div>
          </div>
        </div>

        {isLoading ? (
          <PageLoader />
        ) : (
          <div className={`tbl ${s.wsMemTbl}`}>
            <div className="thead">
              <div>Person</div>
              <div>Workspace role</div>
              <div style={{ textAlign: 'right' }}>Actions</div>
            </div>
            {list.map((m) => {
              const isYou = m.userId === me?.id;
              const soleAdmin = m.role === 'ADMIN' && adminCount <= 1;
              return (
                <div key={m.userId} className="trow">
                  <div className="cell-main">
                    <Avatar person={{ name: m.user.name, color: m.user.color }} size={32} />
                    <div>
                      <div className="nm">
                        {m.user.name} {isYou && <span className="you-tag">You</span>}
                      </div>
                      <div className="sub">{m.user.email}</div>
                    </div>
                  </div>
                  <div>
                    <RoleSelect<WorkspaceRole>
                      value={m.role}
                      options={ROLE_OPTIONS}
                      locked={soleAdmin}
                      onChange={(role) =>
                        setRole.mutate({ workspaceId: ctx.workspaceId, userId: m.userId, role })
                      }
                      renderValue={(r) => <WSChip role={r} />}
                    />
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    {soleAdmin ? (
                      <span className={s.blockedWrap}>
                        <IconButton icon="DeleteOutlined" red disabled style={{ opacity: 0.4 }} />
                        <span className={s.blockedTip}>
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
                            workspaceId: ctx.workspaceId,
                            workspaceName: ctx.name,
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
        )}
      </div>
    </main>
  );
}
