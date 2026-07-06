import { useEffect } from 'react';
import { IconButton, Tooltip } from '@toddle-edu/ds-web';
import { CloseOutlined } from '@toddle-edu/ds-icons';
import { commandModifierKey } from '../../../lib/platform';
import { ShortcutHint } from '../../../components/ShortcutHint';
import { cn } from '../../../lib/cn';
import { SHEET_PANEL_SHORTCUT_KEY } from './constants';

const styles = {
  // Floats over the grid's right edge, Google-Sheets style — the grid keeps its size.
  panel:
    'absolute inset-y-0 right-0 z-10 flex w-80 flex-col rounded-2 border border-secondary bg-surface-primary-enabled shadow-elevation-3-bottom transition-[transform,visibility] duration-200 ease-in-out',
  // 1.5rem matches the shell's p-6, so the slide-out clears the padding gutter too.
  panelClosed: 'invisible translate-x-[calc(100%+1.5rem)]',
  header: 'flex items-center justify-between gap-2 border-b border-secondary py-2 pl-4 pr-2',
  title: 'text-label-s text-primary',
  body: 'flex-1 px-4 py-3 text-body-s text-secondary',
  tooltip: 'flex items-center gap-2',
};

const closeShortcutKeys = [commandModifierKey, SHEET_PANEL_SHORTCUT_KEY];

// While the grid's inline cell editor (or any other text field) has focus, Escape
// belongs to it — the panel only claims Escape from non-typing targets.
const isTypingTarget = (target: EventTarget | null): boolean =>
  (target instanceof HTMLElement && target.isContentEditable) ||
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement;

type SheetPanelProps = { isOpen: boolean; onClose: () => void };

// Overlay for the sheet's cell-level options. Phase 1 is the shell only — the
// cell-type and property controls land here next.
export function SheetPanel({ isOpen, onClose }: Readonly<SheetPanelProps>) {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isTypingTarget(event.target)) return;
      onClose();
    };
    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  return (
    <aside
      aria-label="Cell options"
      aria-hidden={!isOpen}
      className={cn(styles.panel, !isOpen && styles.panelClosed)}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>Cell options</h2>
        <Tooltip
          dsVersion="2.0"
          showArrow
          tooltip={
            <span className={styles.tooltip}>
              Close
              <ShortcutHint keys={closeShortcutKeys} />
            </span>
          }
        >
          <IconButton
            dsVersion="2.0"
            variant="neutral"
            type="plain"
            icon={<CloseOutlined />}
            aria-label="Close cell options"
            onClick={onClose}
          />
        </Tooltip>
      </header>
      <div className={styles.body}>Cell type and formatting options will show up here.</div>
    </aside>
  );
}
