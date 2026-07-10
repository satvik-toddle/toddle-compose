import type * as Y from 'yjs';
import type { DataGridContextMenu, DataGridContextMenuOption } from '@toddle-edu/ds-data-grid';
import {
  ChevronDownOutlined,
  ChevronLeftOutlined,
  ChevronRightOutlined,
  ChevronUpOutlined,
  ClipboardOutlined,
  CopyOutlined,
  DeleteOutlined,
  EraserOutlined,
  ScissorOutlined,
} from '@toddle-edu/ds-icons';
import { pushToast } from '../../../stores/uiStore';
import { commandModifierKey } from '../../../lib/platform';
import { ShortcutHint } from '../../../components/ShortcutHint';
import {
  clearSheetCell,
  clearSheetColumn,
  clearSheetRow,
  deleteSheetColumn,
  deleteSheetRow,
  insertSheetColumn,
  insertSheetRow,
  readSheetCell,
  setSheetCell,
  type SheetColTypes,
  type SheetRows,
} from './sheetModel';

// Right-click menu for sheet cells: menu config plus the dispatch from a clicked
// option to the matching Yjs mutation. Attached to every cell only for editors.

const SHEET_CELL_ACTION = {
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  clearCell: 'clear-cell',
  insertRowAbove: 'insert-row-above',
  insertRowBelow: 'insert-row-below',
  insertColumnLeft: 'insert-column-left',
  insertColumnRight: 'insert-column-right',
  clearRow: 'clear-row',
  clearColumn: 'clear-column',
  deleteRow: 'delete-row',
  deleteColumn: 'delete-column',
} as const;

const MENU_WIDTH_PX = 240;
// The grid overlay's own stacking values — restated because our containerStyles
// override replaces the grid's default object wholesale, not per-property.
const MENU_Z_INDEX = 1000;

const shortcutHint = (letter: string) => <ShortcutHint keys={[commandModifierKey, letter]} />;

// Google-Sheets-style grouping: clipboard, insertion, clearing, deletion.
const SHEET_CELL_MENU_OPTIONS: DataGridContextMenuOption[] = [
  {
    key: SHEET_CELL_ACTION.cut,
    label: 'Cut',
    icon: <ScissorOutlined />,
    suffix: shortcutHint('X'),
  },
  { key: SHEET_CELL_ACTION.copy, label: 'Copy', icon: <CopyOutlined />, suffix: shortcutHint('C') },
  {
    key: SHEET_CELL_ACTION.paste,
    label: 'Paste',
    icon: <ClipboardOutlined />,
    suffix: shortcutHint('V'),
  },
  { key: 'divider-clipboard', isDivider: true },
  { key: SHEET_CELL_ACTION.insertRowAbove, label: 'Insert row above', icon: <ChevronUpOutlined /> },
  {
    key: SHEET_CELL_ACTION.insertRowBelow,
    label: 'Insert row below',
    icon: <ChevronDownOutlined />,
  },
  {
    key: SHEET_CELL_ACTION.insertColumnLeft,
    label: 'Insert column left',
    icon: <ChevronLeftOutlined />,
  },
  {
    key: SHEET_CELL_ACTION.insertColumnRight,
    label: 'Insert column right',
    icon: <ChevronRightOutlined />,
  },
  { key: 'divider-insert', isDivider: true },
  { key: SHEET_CELL_ACTION.clearCell, label: 'Clear content', icon: <EraserOutlined /> },
  { key: SHEET_CELL_ACTION.clearRow, label: 'Clear row', icon: <EraserOutlined /> },
  { key: SHEET_CELL_ACTION.clearColumn, label: 'Clear column', icon: <EraserOutlined /> },
  { key: 'divider-clear', isDivider: true },
  {
    key: SHEET_CELL_ACTION.deleteRow,
    label: 'Delete row',
    icon: <DeleteOutlined variant="critical" />,
    isDestructive: true,
  },
  {
    key: SHEET_CELL_ACTION.deleteColumn,
    label: 'Delete column',
    icon: <DeleteOutlined variant="critical" />,
    isDestructive: true,
  },
];

export function createSheetCellContextMenu(
  ydoc: Y.Doc,
  yRows: SheetRows,
  yColTypes: SheetColTypes,
): DataGridContextMenu {
  const copyCell = async (rowId: string, colId: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(readSheetCell(yRows, rowId, colId));
      return true;
    } catch {
      pushToast({ kind: 'error', message: "Couldn't copy — use Ctrl/Cmd+C instead." });
      return false;
    }
  };

  // Cut clears the cell only after the clipboard write succeeds, so a blocked
  // clipboard never loses data.
  const cutCell = async (rowId: string, colId: string) => {
    if (await copyCell(rowId, colId)) clearSheetCell(ydoc, yRows, rowId, colId);
  };

  // Clipboard read needs a permission grant and is unsupported in some browsers;
  // fall back to pointing at the keyboard shortcut.
  const pasteIntoCell = async (rowId: string, colId: string) => {
    try {
      const text = await navigator.clipboard.readText();
      setSheetCell(ydoc, yRows, rowId, colId, text);
    } catch {
      pushToast({ kind: 'error', message: "Couldn't paste — use Ctrl/Cmd+V instead." });
    }
  };

  const dispatchAction = (actionKey: string, rowId: string, colId: string) => {
    switch (actionKey) {
      case SHEET_CELL_ACTION.cut:
        void cutCell(rowId, colId);
        break;
      case SHEET_CELL_ACTION.copy:
        void copyCell(rowId, colId);
        break;
      case SHEET_CELL_ACTION.paste:
        void pasteIntoCell(rowId, colId);
        break;
      case SHEET_CELL_ACTION.clearCell:
        clearSheetCell(ydoc, yRows, rowId, colId);
        break;
      case SHEET_CELL_ACTION.insertRowAbove:
        insertSheetRow(ydoc, yRows, rowId, 'above');
        break;
      case SHEET_CELL_ACTION.insertRowBelow:
        insertSheetRow(ydoc, yRows, rowId, 'below');
        break;
      case SHEET_CELL_ACTION.insertColumnLeft:
        insertSheetColumn(ydoc, yColTypes, colId, 'left');
        break;
      case SHEET_CELL_ACTION.insertColumnRight:
        insertSheetColumn(ydoc, yColTypes, colId, 'right');
        break;
      case SHEET_CELL_ACTION.clearRow:
        clearSheetRow(ydoc, yRows, rowId);
        break;
      case SHEET_CELL_ACTION.clearColumn:
        clearSheetColumn(ydoc, yRows, colId);
        break;
      case SHEET_CELL_ACTION.deleteRow:
        if (!deleteSheetRow(ydoc, yRows, rowId)) {
          pushToast({ kind: 'info', message: 'A sheet needs at least one row.' });
        }
        break;
      case SHEET_CELL_ACTION.deleteColumn:
        if (!deleteSheetColumn(ydoc, yColTypes, yRows, colId)) {
          pushToast({ kind: 'info', message: 'A sheet needs at least one column.' });
        }
        break;
    }
  };

  return {
    options: SHEET_CELL_MENU_OPTIONS,
    closeOnSelect: true,
    // The grid clamps the menu to the cell's width, truncating options; a fixed
    // containerStyles width gives the labels and shortcut badges room.
    containerStyles: { position: 'relative', zIndex: MENU_Z_INDEX, width: `${MENU_WIDTH_PX}px` },
    onClick: (option, cell) => {
      if (cell.colId == null) return;
      dispatchAction(option.key, cell.rowId, String(cell.colId));
    },
  };
}
