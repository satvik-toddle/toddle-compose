import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppBar } from '../../components/AppBar';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { cn } from '../../lib/cn';
import { SharedWithMeView } from './SharedWithMeView';
import { EmptyState } from '../../components/EmptyState';
import { RealmChip } from '../../components/RealmChip';
import { Avatar } from '../../components/Avatar';
import { PageLoader } from '../../components/Loader';
import { WorkspaceCard } from './WorkspaceCard';
import s from './LauncherPage.module.scss';
import card from './WorkspaceCard.module.scss';
import { useRealm, useWorkspaces } from '../../hooks/queries';
import { useEnterWorkspace } from '../../hooks/useAuthMutations';
import { useAuthStore } from '../../stores/authStore';
import { useUiStore } from '../../stores/uiStore';
import { isRealmAdmin, isUserMember, REALM_ROLE_META } from '../../lib/roles';
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

// Left rail switching the launcher between the workspace grid and the global "Shared with me".
const nav = {
  layout: 'flex flex-1 min-h-0',
  side: 'flex-none w-56 flex flex-col gap-1 p-3 border-r border-secondary',
  item: 'flex items-center gap-2 rounded-1.5 px-2.5 py-2 text-body-s text-secondary cursor-pointer hover:bg-surface-secondary-hover text-left w-full border-0 bg-transparent',
  itemOn: 'bg-surface-secondary-hover text-primary font-semibold',
  main: 'flex-1 min-w-0 min-h-0 flex flex-col overflow-auto',
};

export function LauncherPage() {
  const me = useAuthStore((s) => s.user);
  const { data: realm } = useRealm();
  const { data: workspaces, isLoading } = useWorkspaces();
  const enter = useEnterWorkspace();
  const openModal = useUiStore((s) => s.openModal);
  const navigate = useNavigate();
  const [view, setView] = useState<'workspaces' | 'shared'>('workspaces');

  if (!me) return null;
  const admin = isRealmAdmin(realm?.role);
  const isMember = isUserMember(realm?.role);
  const list = workspaces ?? [];
  const realmName = realm?.name ?? 'Toddle';

  let body: React.ReactNode;
  if (isLoading) {
    body = <PageLoader />;
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
              {isMember && (
                <Button
                  variant="primary"
                  icon="SearchOutlined"
                  onClick={() => navigate('/access')}
                >
                  Discover
                </Button>
              )}
            </div>
          </div>

          {admin && realm && <RoleNote roleLabel={REALM_ROLE_META[realm.role].label} />}

          <div className={s.lcGrid}>
            {list.map((w) => (
              <WorkspaceCard
                key={w.id}
                ws={w}
                showRoleBadge={realm?.role === 'MEMBER'}
                onEnter={() => enter.mutate(w.id)}
              />
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
    <div className="rbac" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppBar realm={realmName} sub="Realm" me={me} realmRole={realm?.role} />
      <div className={nav.layout}>
        <aside className={nav.side}>
          <button
            className={cn(nav.item, view === 'workspaces' && nav.itemOn)}
            onClick={() => setView('workspaces')}
          >
            <Icon name="GridOutlined" size={16} muted />
            Workspaces
          </button>
          <button
            className={cn(nav.item, view === 'shared' && nav.itemOn)}
            onClick={() => setView('shared')}
          >
            <Icon name="MultipleUsersOutlined" size={16} muted />
            Shared with me
          </button>
        </aside>
        <div className={nav.main}>{view === 'shared' ? <SharedWithMeView /> : body}</div>
      </div>
    </div>
  );
}
