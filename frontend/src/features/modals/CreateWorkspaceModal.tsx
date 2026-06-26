import { useMemo, useState } from 'react';
import { Modal, ModalHead } from '../../components/Modal';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useCreateWorkspace } from '../../hooks/useWorkspaceMutations';
import { cn } from '../../lib/cn';
import { WORKSPACE_ICONS } from '../../lib/workspaceVisual';
import type { IconName } from '../../components/iconMap';

export function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const create = useCreateWorkspace();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<IconName>(WORKSPACE_ICONS[0]);

  // Centralised so additional states (e.g. validating, retrying) can be added here later.
  const submitButtonLabel = useMemo(() => {
    if (create.isPending) return 'Creating…';
    return 'Create workspace';
  }, [create.isPending]);

  const submit = () => {
    if (!name.trim() || create.isPending) return;
    create.mutate({ name: name.trim() }, { onSuccess: () => onClose() });
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
