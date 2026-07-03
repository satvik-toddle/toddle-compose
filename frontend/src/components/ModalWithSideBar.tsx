import type { ReactNode } from 'react';
import { Modal as DsModal } from '@toddle-edu/ds-web';

const styles = {
  shell: 'flex w-full max-w-full overflow-hidden rounded-[12px] bg-surface-primary-enabled',
  sidebar: 'flex w-[248px] flex-none flex-col border-r border-secondary bg-surface-secondary-enabled',
  main: 'flex min-w-0 flex-1 flex-col',
};

export function ModalWithSideBar({
  onClose,
  sidebar,
  children,
  width = '920px',
  height = '600px',
}: {
  onClose: () => void;
  sidebar: ReactNode;
  children: ReactNode;
  width?: string;
  height?: string;
}) {
  return (
    <DsModal
      isOpen
      onClose={onClose}
      width={width}
      hasOverlay
      shouldCloseOnOverlayClick
      shouldCloseOnEsc
    >
      <div className="rbac tc-modal">
        <div className={styles.shell} style={{ height, maxHeight: '85vh' }}>
          <aside className={styles.sidebar}>{sidebar}</aside>
          <div className={styles.main}>{children}</div>
        </div>
      </div>
    </DsModal>
  );
}
