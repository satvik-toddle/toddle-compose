import { useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useDocuments } from '../../../hooks/usePages';

// Version-history is driven entirely by the URL: `?history=true` puts the open doc
// into history mode (left panel = versions), and `?v=<seq>` selects which edit
// session to preview. Keeping it in the URL makes a specific version shareable and
// survives reloads.
export function useHistoryMode() {
  const [params, setParams] = useSearchParams();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const docId = params.get('doc');

  // History is DOC-only (SHEET has no read-only lexical render). Resolve the open
  // doc's type here so the invariant lives in ONE place — without it, a SHEET with
  // ?history=true would show a versions panel beside a live, editable sheet.
  const { data: docs } = useDocuments(workspaceId);
  const openDoc = docId ? docs?.find((d) => d.id === docId) : undefined;
  const active = params.get('history') === 'true' && openDoc?.type === 'DOC';

  const seqParam = params.get('v');
  // NaN from a garbage ?v would sail past `!= null` guards into GET /history/NaN; treat non-finite as "none selected".
  const parsedSeq = seqParam != null && seqParam !== '' ? Number(seqParam) : NaN;
  const selectedSeq = Number.isFinite(parsedSeq) ? parsedSeq : null;

  const enter = useCallback(() => {
    setParams((prev) => {
      prev.set('history', 'true');
      prev.delete('v');
      return prev;
    });
  }, [setParams]);

  const exit = useCallback(() => {
    setParams((prev) => {
      prev.delete('history');
      prev.delete('v');
      return prev;
    });
  }, [setParams]);

  const select = useCallback(
    (seq: number) => {
      // replace (not push) so previewing versions doesn't stack history entries; Back still exits history mode in one step.
      setParams(
        (prev) => {
          prev.set('history', 'true');
          prev.set('v', String(seq));
          return prev;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return { active, docId, selectedSeq, enter, exit, select };
}
