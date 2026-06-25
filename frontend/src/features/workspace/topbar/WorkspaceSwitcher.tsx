import { Icon } from '../../../components/Icon';
import { ActionMenu, type MenuItem } from '../../../components/ActionMenu';
import { useRealm, useWorkspaces } from '../../../hooks/queries';
import { useEnterWorkspace, useLeaveWorkspace } from '../../../hooks/useAuthMutations';
import { isRealmAdmin } from '../../../lib/roles';
import { workspaceVisual } from '../../../lib/workspaceVisual';
import type { WorkspaceCtx } from '../context';
import s from '../WorkspaceLayout.module.scss';

export function WorkspaceSwitcher({ ctx }: Readonly<{ ctx: WorkspaceCtx }>) {
  const { data: realm } = useRealm();
  const { data: workspaces = [] } = useWorkspaces();
  const enter = useEnterWorkspace();
  const leave = useLeaveWorkspace();
  const vis = workspaceVisual(ctx.workspaceId);

  // Workspace switcher entries: each workspace (tick on the current one) + a
  // "back to launcher" footer.
  const switcherItems: MenuItem[] = [
    ...workspaces.map((w) => {
      const wv = workspaceVisual(w.id);
      return {
        key: w.id,
        label: w.name,
        icon: wv.icon,
        iconColor: wv.color,
        onSelect: () => {
          if (w.id !== ctx.workspaceId) enter.mutate(w.id);
        },
      };
    }),
    {
      key: '__leave',
      label: isRealmAdmin(realm?.role) ? 'Back to all workspaces' : 'Workspace launcher',
      icon: 'ChevronLeftOutlined',
      dividerBefore: true,
      onSelect: () => leave.mutate(),
    },
  ];

  return (
    <ActionMenu
      placement="bottomLeft"
      header="Switch workspace"
      selectedKey={ctx.workspaceId}
      items={switcherItems}
      trigger={
        <button className={s.wsSwitch}>
          <span
            className="ws-emoji sm"
            style={{ background: vis.color + '22', boxShadow: `inset 0 0 0 1px ${vis.color}44` }}
          >
            <Icon name={vis.icon} size={18} style={{ color: vis.color }} />
          </span>
          <span className="nm">{ctx.name}</span>
          <Icon name="ChevronDownOutlined" size={14} muted />
        </button>
      }
    />
  );
}
