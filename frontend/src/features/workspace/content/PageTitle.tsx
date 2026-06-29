import { useEffect, useState } from 'react';
import { useRenameDocument } from '../../../hooks/usePages';
import { cn } from '../../../lib/cn';
import s from './content.module.scss';

// Coda-style page title shown above the editor body. Editable inline (commits a
// rename on blur / Enter) for editors; a static heading for viewers.
export function PageTitle({
  workspaceId,
  docId,
  title,
  canEdit,
}: {
  workspaceId: string;
  docId: string;
  title: string;
  canEdit: boolean;
}) {
  const rename = useRenameDocument();
  // The default "Untitled" is treated as *unnamed* (Coda-style): the field shows
  // the grey "Untitled" placeholder, not literal title text, until the user names it.
  const named = (t: string) => (t && t !== 'Untitled' ? t : '');
  const [val, setVal] = useState(() => named(title));
  useEffect(() => setVal(named(title)), [title, docId]);

  if (!canEdit) {
    return (
      <h1 className={cn(s.wsDocTitleField, !named(title) && s.untitled)}>{title || 'Untitled'}</h1>
    );
  }

  const commit = () => {
    const t = val.trim();
    if (!t) {
      // unnamed → keep the default "Untitled" stored (tree/list still show it);
      // the field falls back to the grey placeholder
      if (title && title !== 'Untitled')
        rename.mutate({ workspaceId, id: docId, title: 'Untitled' });
      setVal('');
      return;
    }
    if (t !== title) rename.mutate({ workspaceId, id: docId, title: t });
  };

  // data-value feeds the CSS auto-grow mirror
  return (
    <div className={s.wsDocTitleGrow} data-value={val}>
      <textarea
        className={s.wsDocTitleField}
        value={val}
        placeholder="Add a page title"
        aria-label="Page title"
        rows={1}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
