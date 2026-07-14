import { ToggleSwitch } from '@toddle-edu/ds-web';

// Small "Preview" switch shown in the field header, in-workspace only.
export function PreviewToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="gs-prevtoggle">
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
