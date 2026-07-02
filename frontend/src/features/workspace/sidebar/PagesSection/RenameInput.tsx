import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';

// Inline title editor: commits on Enter/blur, cancels on Escape.
export function RenameInput({
  initial,
  onCommit,
  onCancel,
}: Readonly<{ initial: string; onCommit: (value: string) => void; onCancel: () => void }>) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards the blur that follows Enter/Escape from finishing twice.
  const doneRef = useRef(false);

  // rAF so focus lands after the actions dropdown restores focus to its trigger on close.
  // Caret at the end (no select-all): the blinking caret is the edit affordance.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value);

  const handleBlur = () => finish(true);

  const handleClick = (e: MouseEvent<HTMLInputElement>) => e.stopPropagation();

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  };

  return (
    <input
      ref={inputRef}
      value={value}
      aria-label="Page name"
      className="min-w-0 flex-1 border-0 bg-transparent p-0 text-inherit outline-none [font:inherit]"
      onChange={handleChange}
      onBlur={handleBlur}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    />
  );
}
