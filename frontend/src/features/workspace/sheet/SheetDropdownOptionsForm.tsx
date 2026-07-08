import { useState } from 'react';
import {
  Button,
  DragAndDropList,
  ToggleSwitch,
  type DragAndDropListItemInterfaceV2,
} from '@toddle-edu/ds-web';
import type { SheetDropdownOption, SheetOptionSet } from './sheetModel';

const styles = {
  form: 'flex flex-1 flex-col gap-3',
  optionsList: 'pl-4',
  multiRow: 'flex items-center justify-between gap-2',
  multiLabel: 'text-body text-primary',
  actions:
    'sticky bottom-0 flex justify-end gap-2 border-t border-secondary bg-surface-primary-enabled py-2',
};

const MULTI_TOGGLE_LABEL_ID = 'sheet-dropdown-multi-label';

const makeDraftOption = (): SheetDropdownOption => ({ id: crypto.randomUUID(), label: '' });

const draftFromSet = (optionSet: SheetOptionSet | null): SheetDropdownOption[] =>
  optionSet && optionSet.options.length > 0 ? optionSet.options : [makeDraftOption()];

const toListItems = (options: SheetDropdownOption[]): DragAndDropListItemInterfaceV2[] =>
  options.map((option) => ({ id: option.id, value: option.label }));

const fromListItems = (items: DragAndDropListItemInterfaceV2[]): SheetDropdownOption[] =>
  items.map((item) => ({
    id: String(item.id),
    label: typeof item.value === 'string' ? item.value : '',
  }));

// Blank rows get random ids, so dirtiness compares labels (and order) only.
const draftSignature = (options: SheetDropdownOption[], isMulti: boolean): string =>
  JSON.stringify({ labels: options.map((option) => option.label), isMulti });

type SheetDropdownOptionsFormProps = {
  optionSet: SheetOptionSet | null;
  onSave: (optionSet: SheetOptionSet) => void;
};

// Buffered editor for a dropdown's option list: edits (including reorders) stay local until Save, so half-typed options never reach collaborators. Blank labels are dropped on save.
export function SheetDropdownOptionsForm({
  optionSet,
  onSave,
}: Readonly<SheetDropdownOptionsFormProps>) {
  const [draftOptions, setDraftOptions] = useState<SheetDropdownOption[]>(() =>
    draftFromSet(optionSet),
  );
  const [isMulti, setIsMulti] = useState(optionSet?.isMulti ?? false);

  // Pristine (form-lib term): the draft still equals the saved set — nothing to save or discard, so Save/Cancel stay disabled.
  const isPristine =
    draftSignature(draftOptions, isMulti) ===
    draftSignature(draftFromSet(optionSet), optionSet?.isMulti ?? false);

  const save = () => {
    const options = draftOptions
      .map((option) => ({ ...option, label: option.label.trim() }))
      .filter((option) => option.label !== '');
    onSave({ options, isMulti });
  };

  const cancel = () => {
    setDraftOptions(draftFromSet(optionSet));
    setIsMulti(optionSet?.isMulti ?? false);
  };

  return (
    <div className={styles.form}>
      <div className={styles.optionsList}>
        <DragAndDropList
          dsVersion="2.0"
          dndKey="sheet-dropdown-options"
          value={toListItems(draftOptions)}
          onValueChange={(items: DragAndDropListItemInterfaceV2[]) =>
            setDraftOptions(fromListItems(items))
          }
          label="Options"
          addItemText="Add option"
          itemPlaceholder="Option label"
        />
      </div>
      <div className={styles.multiRow}>
        <span id={MULTI_TOGGLE_LABEL_ID} className={styles.multiLabel}>
          Allow multiple selections
        </span>
        <ToggleSwitch
          dsVersion="2.0"
          size="medium"
          aria-labelledby={MULTI_TOGGLE_LABEL_ID}
          checked={isMulti}
          onChange={(event) => setIsMulti(event.target.checked)}
        />
      </div>
      <div className={styles.actions}>
        <Button
          dsVersion="2.0"
          type="outlined"
          variant="neutral"
          disabled={isPristine}
          onClick={cancel}
        >
          Cancel
        </Button>
        <Button dsVersion="2.0" disabled={isPristine} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
