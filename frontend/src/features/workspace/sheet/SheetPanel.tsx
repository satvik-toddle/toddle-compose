import { useEffect, type ComponentType } from 'react';
import { EmptyState, IconButton, SelectDropdown, Tooltip } from '@toddle-edu/ds-web';
import { EmptyStateIllustrations } from '@toddle-edu/ds-theme';
import { CloseOutlined } from '@toddle-edu/ds-icons';
import { commandModifierKey } from '../../../lib/platform';
import { ShortcutHint } from '../../../components/ShortcutHint';
import { cn } from '../../../lib/cn';
import {
  SHEET_CELL_TYPE_OPTIONS,
  SHEET_PANEL_SHORTCUT_KEY,
  type SheetCellTypeOption,
} from './constants';
import { SheetDropdownOptionsForm } from './SheetDropdownOptionsForm';
import type { SheetCellType, SheetOptionSet } from './sheetModel';

const styles = {
  // Docked beside the grid, Google-Sheets style — opening it shrinks the grid so every column stays in the viewport instead of being covered.
  panel:
    'flex shrink-0 flex-col overflow-hidden rounded-2 border border-secondary bg-surface-primary-enabled transition-[width,margin,visibility] duration-200 ease-in-out',
  panelOpen: 'ml-2 w-80',
  panelClosed: 'invisible ml-0 w-0',
  // Fixed at the open width so the content clips instead of reflowing mid-animation.
  panelContent: 'flex h-full w-80 shrink-0 flex-col',
  header: 'flex items-center justify-between gap-2 border-b border-secondary p-2',
  title: 'text-heading-6 text-primary',
  body: 'flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto px-4 pt-2',
  rangeSection: 'flex flex-col gap-1',
  rangeLabel: 'text-label text-secondary',
  rangeValue: 'text-body text-primary',
  tooltip: 'flex items-center gap-2',
};

const closeShortcutKeys = [commandModifierKey, SHEET_PANEL_SHORTCUT_KEY];

// SelectDropdown's version-union type drops value/onChange (same gap RoleSelect
// works around); retype it narrowly for this picker.
type CellTypeSelectProps = {
  dsVersion: '2.0';
  label: string;
  options: readonly SheetCellTypeOption[];
  value?: SheetCellTypeOption;
  onChange: (option: SheetCellTypeOption | null) => void;
  placeholder?: string;
  isClearable?: boolean;
  isCreatable?: boolean;
  isSearchable?: boolean;
};
const CellTypeSelect = SelectDropdown as unknown as ComponentType<CellTypeSelectProps>;

// While the grid's inline cell editor (or any other text field) has focus, Escape
// belongs to it — the panel only claims Escape from non-typing targets.
const isTypingTarget = (target: EventTarget | null): boolean =>
  (target instanceof HTMLElement && target.isContentEditable) ||
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement;

type SheetPanelProps = {
  isOpen: boolean;
  selectionLabel: string | null;
  cellType: SheetCellType | 'mixed' | null;
  onCellTypeChange: (type: SheetCellType) => void;
  dropdownOptionSetId: string | null;
  dropdownOptionSet: SheetOptionSet | null;
  onSaveDropdownOptions: (optionSet: SheetOptionSet) => void;
  onClose: () => void;
};

// Docked side panel for the sheet's cell-level options.
export function SheetPanel({
  isOpen,
  selectionLabel,
  cellType,
  onCellTypeChange,
  dropdownOptionSetId,
  dropdownOptionSet,
  onSaveDropdownOptions,
  onClose,
}: Readonly<SheetPanelProps>) {
  const selectedTypeOption =
    SHEET_CELL_TYPE_OPTIONS.find((option) => option.value === cellType) ?? null;

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
      aria-label="Cell configuration"
      aria-hidden={!isOpen}
      className={cn(styles.panel, isOpen ? styles.panelOpen : styles.panelClosed)}
    >
      <div className={styles.panelContent}>
        <header className={styles.header}>
          <h2 className={styles.title}>Cell configuration</h2>
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
              aria-label="Close cell configuration"
              onClick={onClose}
            />
          </Tooltip>
        </header>
        <div className={styles.body}>
          {selectionLabel ? (
            <>
              <div className={styles.rangeSection}>
                <span className={styles.rangeLabel}>Applies to</span>
                <span className={styles.rangeValue}>{selectionLabel}</span>
              </div>
              <CellTypeSelect
                dsVersion="2.0"
                label="Cell type"
                options={SHEET_CELL_TYPE_OPTIONS}
                value={selectedTypeOption ?? undefined}
                onChange={(option) => option && onCellTypeChange(option.value)}
                placeholder={cellType === 'mixed' ? 'Mixed' : 'Select cell type'}
                isClearable={false}
                isCreatable={false}
                isSearchable={false}
              />
              {cellType === 'dropdown' && (
                <SheetDropdownOptionsForm
                  // Remount when the target set (or a set-less selection) changes so the
                  // draft never leaks across ranges.
                  key={dropdownOptionSetId ?? `new-${selectionLabel}`}
                  optionSet={dropdownOptionSet}
                  onSave={onSaveDropdownOptions}
                />
              )}
            </>
          ) : (
            <EmptyState
              dsVersion="2.0"
              illustration={EmptyStateIllustrations.NoDataIllustration}
              title="No cells selected"
              subtitle="Select a cell or a range of cells to configure it."
            />
          )}
        </div>
      </div>
    </aside>
  );
}
