import type { SheetCellType, SheetDateTimeVariant } from './sheetModel';

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
  { label: 'Tag', value: 'tag' },
  { label: 'Date & time', value: 'dateTime' },
];

export type SheetDateTimeVariantOption = { label: string; value: SheetDateTimeVariant };

export const SHEET_DATE_TIME_VARIANT_OPTIONS: readonly SheetDateTimeVariantOption[] = [
  { label: 'Date & time', value: 'dateTime' },
  { label: 'Date', value: 'date' },
  { label: 'Time', value: 'time' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'Year', value: 'year' },
];
