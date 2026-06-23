import { useNavigate } from 'react-router-dom';
import { AppBar } from '../../components/AppBar';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { EmptyState } from '../../components/EmptyState';
import { RealmChip } from '../../components/RealmChip';
import { Avatar } from '../../components/Avatar';
import { PageSpinner } from '../../components/Spinner';
import { WorkspaceCard } from './WorkspaceCard';
import s from './LauncherPage.module.scss';
import card from './WorkspaceCard.module.scss';
import { useRealm, useWorkspaces } from '../../hooks/queries';
import { useEnterWorkspace } from '../../hooks/useAuthMutations';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { isRealmAdmin, REALM_ROLE_META } from '../../lib/roles';
import { greet, firstName } from '../../lib/time';
import type { User } from '../../types/api';

function RoleNote({ roleLabel }: { roleLabel: string }) {
  return (
    <div className={s.lcNote}>
      <Icon name="InformationOutlined" size={14} muted />
      As a realm {roleLabel.toLowerCase()}, you can enter <b>any</b> workspace and act as its Admin.
    </div>
  );
}

function EmptyMember({ me, onFind }: { me: User; onFind: () => void }) {
  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center' }}>
      <div className="page-wrap">
        <EmptyState
          glyph="🪪"
          glyphStyle={{ background: 'var(--surface-secondary-enabled)' }}
          title="You're not in any workspaces yet"
          actions={
            <>
              <Button variant="primary" icon="SearchOutlined" onClick={onFind}>
                Find a workspace
              </Button>
              <Button variant="ghost" icon="HelpOutlined">
                How access works
              </Button>
            </>
          }
          footer={
            <div className={s.lcWaitcard}>
              <Avatar person={{ name: me.name, color: me.color }} size={30} />
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{me.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {me.email} ·{' '}
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <RealmChip role="MEMBER" sm />
                  </span>
                </div>
              </div>
            </div>
          }
        >
          Your account is ready. Ask a realm admin to add you to a workspace, or find one to join —
          it'll appear here automatically.
        </EmptyState>
      </div>
    </div>
  );
}

function EmptyOwner({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="page" style={{ display: 'flex', alignItems: 'center' }}>
      <div className="page-wrap">
        <EmptyState
          glyph="🚀"
          glyphStyle={{ background: 'var(--red-950)' }}
          title="Create your first workspace"
          actions={
            <Button variant="primary" size="lg" icon="AddOutlined" onClick={onCreate}>
              New workspace
            </Button>
          }
        >
          Workspaces are where your team writes and organizes docs. Spin one up, then add people and
          set their roles — you'll be its Admin automatically.
        </EmptyState>
      </div>
    </div>
  );
}

export function LauncherPage() {
  const me = useAuthStore((s) => s.user);
  const { data: realm } = useRealm();
  const { data: workspaces, isLoading } = useWorkspaces();
  const enter = useEnterWorkspace();
  const openModal = useUiStore((s) => s.openModal);
  const navigate = useNavigate();

  if (!me) return null;
  const admin = isRealmAdmin(realm?.role);
  const list = workspaces ?? [];
  const realmName = realm?.name ?? 'Toddle';

  let body: React.ReactNode;
  if (isLoading) {
    body = <PageSpinner />;
  } else if (list.length === 0) {
    body = admin ? (
      <EmptyOwner onCreate={() => openModal({ type: 'createWorkspace' })} />
    ) : (
      <EmptyMember me={me} onFind={() => navigate('/access')} />
    );
  } else {
    body = (
      <div className="page">
        <div className="page-wrap">
          <div className={s.lcGreet}>
            <div>
              <h1>
                {greet()}, {firstName(me.name)}
              </h1>
              <div className="sub">
                You can reach <b>{list.length}</b> {list.length === 1 ? 'workspace' : 'workspaces'} in{' '}
                {realmName} · signed in as {me.email}
              </div>
            </div>
            <div className={s.lcGreetActions}>
              {admin && (
                <Button icon="DashboardOutlined" onClick={() => navigate('/admin')}>
                  Admin console
                </Button>
              )}
              {admin && (
                <Button
                  variant="primary"
                  icon="AddOutlined"
                  onClick={() => openModal({ type: 'createWorkspace' })}
                >
                  New workspace
                </Button>
              )}
            </div>
          </div>

          {admin && realm && <RoleNote roleLabel={REALM_ROLE_META[realm.role].label} />}

          <div className={s.lcGrid}>
            {list.map((w) => (
              <WorkspaceCard key={w.id} ws={w} overlay={admin} onEnter={() => enter.mutate(w.id)} />
            ))}
            {admin && (
              <button className={`${card.wsCard} ${card.add}`} onClick={() => openModal({ type: 'createWorkspace' })}>
                <span className={card.addGlyph}>
                  <Icon name="AddOutlined" size={20} muted />
                </span>
                <span className={card.addNm}>New workspace</span>
                <span className={card.addDs}>Create a space and invite your team</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rbac">
      <AppBar realm={realmName} sub="Realm" me={me} realmRole={realm?.role} />
      {body}
    </div>
  );
}
