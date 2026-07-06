import type { SheetCellType } from './sheetModel';

// Cmd/Ctrl + this key toggles the sheet panel (the sidebar owns Cmd+\).
export const SHEET_PANEL_SHORTCUT_KEY = '/';

export type SheetCellTypeOption = { label: string; value: SheetCellType };

export const SHEET_CELL_TYPE_OPTIONS: readonly SheetCellTypeOption[] = [
  { label: 'Text', value: 'text' },
  { label: 'Number', value: 'number' },
  { label: 'Checkbox', value: 'checkbox' },
  { label: 'Toggle', value: 'toggle' },
  { label: 'Radio', value: 'radio' },
  { label: 'Dropdown', value: 'dropdown' },
];
