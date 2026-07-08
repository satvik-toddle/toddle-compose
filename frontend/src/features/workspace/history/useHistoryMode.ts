import { useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useDocuments } from '../../../hooks/usePages';

// URL-driven history: `?history=true` puts the open doc into history mode and `?v=<seq>` selects the version — kept in the URL so a version is shareable and survives reload.
export function useHistoryMode() {
  const [params, setParams] = useSearchParams();
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const docId = params.get('doc');

  // History is DOC-only (SHEET has no read-only lexical render); resolving the open doc here keeps that invariant in ONE place and is reused by callers (see openDoc below).
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

  return { active, docId, openDoc, selectedSeq, enter, exit, select };
}
