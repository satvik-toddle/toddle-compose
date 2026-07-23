import { useEffect, useRef } from 'react';
import { SearchOutlined } from '@toddle-edu/ds-icons';
import { SpinnerLoader } from '@toddle-edu/ds-web';
import { PreviewToggle } from './PreviewToggle';

const styles = {
  field: 'flex items-center gap-3 h-[60px] px-[18px] flex-none border-b border-solid border-secondary',
  mag: 'w-5.5 h-5.5 opacity-[0.55] flex-none text-secondary',
  magWrap: 'w-5.5 h-5.5 flex-none flex items-center justify-center',
  input:
    'flex-1 border-0 outline-none focus:outline-none focus-visible:outline-none bg-transparent text-size-300 text-primary min-w-0 caret-[var(--red-400)] placeholder:text-placeholder',
};

// The 60px header row: search glyph, borderless autofocusing input, optional
// preview toggle (in-workspace), and an Esc chip.
export function SearchField({
  value,
  onChange,
  showToggle,
  previewOn,
  setPreviewOn,
  isSearching,
}: {
  value: string;
  onChange: (v: string) => void;
  showToggle: boolean;
  previewOn: boolean;
  setPreviewOn: (v: boolean) => void;
  isSearching?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on mount even if the ds-web modal grabs focus first.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className={styles.field}>
      {/* Spinner replaces the glyph while a search is in flight (only feedback during the first fetch). */}
      {isSearching ? (
        <span className={styles.magWrap}>
          <SpinnerLoader size="small" />
        </span>
      ) : (
        <SearchOutlined className={styles.mag} aria-hidden />
      )}
      {/* Native input kept: bespoke 60px borderless field with inline toggle+hint — DS TextInput/SearchInput can't be made borderless at this geometry. */}
      <input
        ref={inputRef}
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search docs by title or content…"
        aria-label="Search documents"
      />
      {showToggle && <PreviewToggle checked={previewOn} onChange={setPreviewOn} />}
    </div>
  );
}
