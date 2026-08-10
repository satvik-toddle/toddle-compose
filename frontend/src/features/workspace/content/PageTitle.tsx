import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { TextAreaInput } from '@toddle-edu/ds-web';
import { useRenameDocument } from '../../../hooks/usePages';
import { DEFAULT_PAGE_TITLE } from '../constants';

const styles = {
  // strips the DS field chrome; primitives restore heading-1 type (DS text-body outranks it)
  field:
    '!border-0 !rounded-0 !p-0 !bg-transparent overflow-hidden font-avenirNext text-size-800 font-weight-700 leading-700 text-primary break-words [word-break:break-word] placeholder:font-weight-600',
  heading: 'm-0 text-heading-1 whitespace-pre-wrap break-words [word-break:break-word]',
  named: 'text-primary',
  // grey colour for an unnamed page (flips with the theme, unlike a raw neutral)
  unnamed: 'text-placeholder',
};

// A page is "named" once it has a non-empty title other than the default; an
// unnamed page shows a blank field so the grey placeholder shows through.
const isNamed = (title: string) => !!title && title !== DEFAULT_PAGE_TITLE;

type PageTitleProps = {
  workspaceId: string;
  docId: string;
  title: string;
  canEdit: boolean;
};

// Coda-style page title shown above the editor body. Editable inline (commits a
// rename on blur / Enter) for editors; a static heading for viewers.
export function PageTitle({ workspaceId, docId, title, canEdit }: Readonly<PageTitleProps>) {
  const rename = useRenameDocument();
  const [draft, setDraft] = useState(() => (isNamed(title) ? title : ''));
  useEffect(() => setDraft(isNamed(title) ? title : ''), [title, docId]);

  // The DS textarea autosizes only on value/window-resize; re-render on width
  // changes (e.g. sidebar collapse) so a rewrapped multi-line title re-measures.
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [, onWidthChange] = useState(0);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    let width = el.offsetWidth;
    const observer = new ResizeObserver(() => {
      if (el.offsetWidth === width) return;
      width = el.offsetWidth;
      onWidthChange((n) => n + 1);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canEdit]);

  if (!canEdit) {
    const titleColor = isNamed(title) ? styles.named : styles.unnamed;
    // dir="auto" matches the editable field so RTL titles align the same by role
    return (
      <h1 dir="auto" className={`${styles.heading} ${titleColor}`}>
        {title || DEFAULT_PAGE_TITLE}
      </h1>
    );
  }

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      // unnamed → keep the default stored (tree/list still show it); the field
      // falls back to the grey placeholder
      if (isNamed(title)) rename.mutate({ workspaceId, id: docId, title: DEFAULT_PAGE_TITLE });
      setDraft('');
      return;
    }
    if (trimmed !== title) rename.mutate({ workspaceId, id: docId, title: trimmed });
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing: Enter during IME conversion picks a candidate, not commit
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.currentTarget.blur();
  };

  return (
    <TextAreaInput
      ref={areaRef}
      dsVersion="2.0"
      className={styles.field}
      value={draft}
      minRows={1}
      placeholder="Add a page title"
      aria-label="Page title"
      onChange={handleChange}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
}
