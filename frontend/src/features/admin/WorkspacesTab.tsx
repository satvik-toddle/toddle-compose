import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { PageLoader } from '../../components/Loader';
import s from './WorkspacesTab.module.scss';
import { useWorkspaces } from '../../hooks/queries';
import { useEnterWorkspace } from '../../hooks/useAuthMutations';
import { useUiStore } from '../../stores/uiStore';
import { workspaceVisual } from '../../lib/workspaceVisual';
import { formatDate } from '../../lib/time';
import { WS_ROLE_META } from '../../lib/roles';

export function WorkspacesTab() {
  const { data: workspaces, isLoading } = useWorkspaces();
  const enter = useEnterWorkspace();
  const openModal = useUiStore((s) => s.openModal);

  if (isLoading) return <div className="page"><div className="page-wrap"><PageLoader /></div></div>;
  const list = workspaces ?? [];

  return (
    <div className="page">
      <div className="page-wrap">
        <div className="page-head">
          <div>
            <h1>Workspaces</h1>
            <div className="sub">Every workspace in the realm. You have Admin access to all of them.</div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button icon="ImportOutlined" onClick={() => openModal({ type: 'importWorkspace' })}>
              Import workspace
            </Button>
            <Button variant="primary" icon="AddOutlined" onClick={() => openModal({ type: 'createWorkspace' })}>
              New workspace
            </Button>
          </div>
        </div>

        <div className={`tbl ${s.adWsTbl}`}>
          <div className="thead">
            <div>Workspace</div>
            <div>Default access</div>
            <div>Created</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>
          {list.map((w) => {
            const vis = workspaceVisual(w.id);
            return (
              <div key={w.id} className="trow">
                <div className="cell-main">
                  <span
                    className="ws-emoji sm"
                    style={{ background: `var(--tag-background-${vis.hue}-default)` }}
                  >
                    <Icon name={vis.icon} size={18} style={{ color: `var(--tag-foreground-${vis.hue})` }} />
                  </span>
                  <div>
                    <div className="nm">{w.name}</div>
                    <div className="sub">{w.visibility === 'PUBLIC' ? 'Public' : 'Private'}</div>
                  </div>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>
                  Joins as {WS_ROLE_META[w.defaultRole].label}
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>{formatDate(w.createdAt)}</div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <Button size="sm" iconRight="ChevronRightOutlined" onClick={() => enter.mutate(w.id)}>
                    Open
                  </Button>
                  <IconButton
                    icon="PencilOutlined"
                    title="Rename"
                    onClick={() =>
                      openModal({ type: 'renameWorkspace', workspaceId: w.id, name: w.name, icon: vis.icon })
                    }
                  />
                  <IconButton
                    icon="DeleteOutlined"
                    red
                    title="Delete"
                    onClick={() =>
                      openModal({ type: 'confirmDeleteWorkspace', workspaceId: w.id, name: w.name })
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div className={s.adFoot}>{list.length} workspaces</div>
      </div>
    </div>
  );
}
