import { useEffect, useState } from 'react';
import { useRenameDocument } from '../../../hooks/usePages';
import { DEFAULT_PAGE_TITLE } from '../constants';
import titleStyles from './PageTitle.module.scss';

const styles = {
  field:
    'block w-full m-0 p-0 border-0 outline-0 bg-transparent resize-none overflow-hidden text-heading-1 text-primary whitespace-pre-wrap break-words [word-break:break-word] placeholder:text-placeholder placeholder:font-weight-600',
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

  if (!canEdit) {
    const titleColor = isNamed(title) ? styles.named : styles.unnamed;
    return <h1 className={`${styles.heading} ${titleColor}`}>{title || DEFAULT_PAGE_TITLE}</h1>;
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

  // data-value feeds the CSS auto-grow mirror; text-heading-1 sits here too so
  // the mirror inherits the same type as the textarea.
  return (
    <div className={`${titleStyles.autoGrow} text-heading-1`} data-value={draft}>
      <textarea
        className={styles.field}
        value={draft}
        placeholder="Add a page title"
        aria-label="Page title"
        rows={1}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
