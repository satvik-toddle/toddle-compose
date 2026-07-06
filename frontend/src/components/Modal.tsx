import type { ReactNode } from 'react';
import { Modal as DsModal } from '@toddle-edu/ds-web';
import { Icon, type IconName } from './Icon';
import { IconButton } from './IconButton';

export type ModalTone = 'neutral' | 'brand' | 'danger';

const TONE_BG: Record<ModalTone, string> = {
  neutral: 'var(--surface-secondary-enabled)',
  brand: 'var(--red-950)',
  danger: 'var(--surface-semantic-error)',
};
const TONE_ICON: Record<ModalTone, string> = {
  neutral: 'var(--text-secondary)',
  brand: 'var(--interactive-primary)',
  danger: 'var(--text-semantic-error)',
};

export function ModalHead({
  tone = 'neutral',
  icon,
  title,
  sub,
  onClose,
}: {
  tone?: ModalTone;
  icon?: IconName;
  title: ReactNode;
  sub?: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="m-head">
      {icon && (
        <span className="m-ic" style={{ background: TONE_BG[tone] }}>
          <Icon name={icon} size={18} style={{ color: TONE_ICON[tone] }} />
        </span>
      )}
      <div style={{ flex: 1 }}>
        <h3 className="text-primary">{title}</h3>
        {sub && <p>{sub}</p>}
      </div>
      <IconButton icon="CloseOutlined" iconSize={18} onClick={onClose} aria-label="Close" />
    </div>
  );
}

// ds-web Modal provides the overlay + centered content box; our ModalHead/.m-body/
// .m-foot render inside it (their CSS is scoped to .rbac, no longer to .modal).
export function Modal({
  onClose,
  children,
  wide,
}: {
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <DsModal
      dsVersion="2.0"
      isOpen
      onClose={onClose}
      width={wide ? '560px' : '440px'}
      hasOverlay
      shouldCloseOnOverlayClick
      shouldCloseOnEsc
    >
      <div className="rbac tc-modal">{children}</div>
    </DsModal>
  );
}
