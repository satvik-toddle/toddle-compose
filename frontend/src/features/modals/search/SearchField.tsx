import { useEffect, useRef } from 'react';
import { SearchOutlined } from '@toddle-edu/ds-icons';
import { ShortcutHint } from '../../../components/ShortcutHint';
import { PreviewToggle } from './PreviewToggle';

// The 60px header row: search glyph, borderless autofocusing input, optional
// preview toggle (in-workspace), and an Esc chip.
export function SearchField({
  value,
  onChange,
  showToggle,
  previewOn,
  setPreviewOn,
}: {
  value: string;
  onChange: (v: string) => void;
  showToggle: boolean;
  previewOn: boolean;
  setPreviewOn: (v: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on mount even if the ds-web modal grabs focus first.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="gs-field">
      <SearchOutlined className="mag" aria-hidden />
      {/* Native input kept: bespoke 60px borderless field with inline toggle+hint — DS TextInput/SearchInput can't be made borderless at this geometry. */}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search docs by title or content…"
        aria-label="Search documents"
      />
      {showToggle && <PreviewToggle checked={previewOn} onChange={setPreviewOn} />}
      <ShortcutHint keys={['Esc']} />
    </div>
  );
}
