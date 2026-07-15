import { ToggleSwitch } from '@toddle-edu/ds-web';

const styles = {
  toggle: 'inline-flex items-center gap-2 flex-none text-size-75 font-weight-600 text-secondary cursor-pointer',
};

// Small "Preview" switch shown in the field header, in-workspace only.
export function PreviewToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={styles.toggle}>
      <span>Preview</span>
      <ToggleSwitch
        dsVersion="2.0"
        size="medium"
        checked={checked}
        onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        aria-label="Toggle document preview"
      />
    </label>
  );
}
