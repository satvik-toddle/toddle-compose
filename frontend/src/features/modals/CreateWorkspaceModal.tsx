import { useState } from 'react';
import { Modal, ModalHead } from '../../components/Modal';
import { Field } from '../../components/Field';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { useCreateWorkspace } from '../../hooks/useWorkspaceMutations';
import { cn } from '../../lib/cn';

const EMOJIS = ['🚀', '🛠️', '🎨', '📣', '🌱', '📈', '🔬', '📚', '💡', '🧭', '🗂️', '⚡'];

export function CreateWorkspaceModal({ onClose }: { onClose: () => void }) {
  const create = useCreateWorkspace();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🚀');

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
            <span className="emoji-btn">{emoji}</span>
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
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                className={cn('emoji-cell', e === emoji && 'on')}
                onClick={() => setEmoji(e)}
              >
                {e}
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
          {create.isPending ? 'Creating…' : 'Create workspace'}
        </Button>
      </div>
    </Modal>
  );
}
