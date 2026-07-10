import { useMemo, useState } from 'react';
import { Modal, ModalHead } from '../../components/Modal';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useCreateWorkspace } from '../../hooks/useWorkspaceMutations';
import { cn } from '../../lib/cn';
import { WORKSPACE_ICONS } from '../../lib/workspaceVisual';
import type { IconName } from '../../components/iconMap';
import type { Visibility } from '../../types/roles';

const styles = {
  vis: 'flex flex-col gap-2',
  visOpt:
    'flex items-center gap-3 p-3 rounded-2.5 border-1 border-secondary bg-surface-primary-enabled text-left cursor-pointer text-primary hover:bg-surface-secondary-hover',
  visOptOn: 'border-selected',
  visBody: 'flex-1 min-w-0',
  visTitle: 'text-body-s font-weight-600',
  visDesc: 'text-body-s text-secondary',
};

export function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const create = useCreateWorkspace();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<IconName>(WORKSPACE_ICONS[0]);
  const [visibility, setVisibility] = useState<Visibility>('PRIVATE');

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const submitButtonLabel = useMemo(() => {
    if (create.isPending) return 'Creating…';
    return 'Create workspace';
  }, [create.isPending]);

  const submit = () => {
    if (!name.trim() || create.isPending) return;
    create.mutate({ name: name.trim(), visibility }, { onSuccess: () => onClose() });
  };

  return (
    <Modal onClose={onClose}>
      <ModalHead
        tone="brand"
        icon="AddOutlined"
        title="Create a workspace"
        sub="You'll become its Admin and drop straight into it."
        onClose={onClose}
      />
      <div className="m-body">
        <Field label="Workspace name">
          <span className="inp inp-emoji">
            <span className="emoji-btn"><Icon name={icon} size={18} /></span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer Research"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
          </span>
        </Field>
        <Field label="Icon">
          <div className="emoji-grid">
            {WORKSPACE_ICONS.map((ic) => (
              <button
                key={ic}
                type="button"
                className={cn('emoji-cell', ic === icon && 'on')}
                onClick={() => setIcon(ic)}
              >
                <Icon
                  name={ic}
                  size={18}
                  style={ic === icon ? { color: 'var(--interactive-primary)' } : undefined}
                />
              </button>
            ))}
          </div>
        </Field>
        <Field label="Visibility">
          <div className={styles.vis}>
            <button
              type="button"
              className={cn(styles.visOpt, visibility === 'PRIVATE' && styles.visOptOn)}
              onClick={() => setVisibility('PRIVATE')}
            >
              <Icon name="LockOutlined" size={18} muted />
              <div className={styles.visBody}>
                <div className={styles.visTitle}>Private</div>
                <div className={styles.visDesc}>People join by request and approval</div>
              </div>
              {visibility === 'PRIVATE' && <Icon name="TickSmallOutlined" size={16} />}
            </button>
            <button
              type="button"
              className={cn(styles.visOpt, visibility === 'PUBLIC' && styles.visOptOn)}
              onClick={() => setVisibility('PUBLIC')}
            >
              <Icon name="GlobeOutlined" size={18} muted />
              <div className={styles.visBody}>
                <div className={styles.visTitle}>Public</div>
                <div className={styles.visDesc}>Anyone in the realm can join</div>
              </div>
              {visibility === 'PUBLIC' && <Icon name="TickSmallOutlined" size={16} />}
            </button>
          </div>
        </Field>
        <div className="m-note">
          <Icon name="InformationOutlined" size={14} muted />
          Members are added after the workspace is created.
        </div>
      </div>
      <div className="m-foot">
        <span className="gap" />
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" icon="AddOutlined" disabled={!name.trim() || create.isPending} onClick={submit}>
          {submitButtonLabel}
        </Button>
      </div>
    </Modal>
  );
}
