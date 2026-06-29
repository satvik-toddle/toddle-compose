import { useEffect, useState } from 'react';
import { useRenameDocument } from '../../../hooks/usePages';
import { cn } from '../../../lib/cn';
import { DEFAULT_PAGE_TITLE } from '../constants';
import s from './content.module.scss';

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
    return (
      <h1 className={cn(s.wsDocTitleField, !isNamed(title) && s.untitled)}>
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

  // data-value feeds the CSS auto-grow mirror
  return (
    <div className={s.wsDocTitleGrow} data-value={draft}>
      <textarea
        className={s.wsDocTitleField}
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
