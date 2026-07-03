import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

// Version-history is driven entirely by the URL: `?history=true` puts the open doc
// into history mode (left panel = versions), and `?v=<seq>` selects which edit
// session to preview. Keeping it in the URL makes a specific version shareable and
// survives reloads.
export function useHistoryMode() {
  const [params, setParams] = useSearchParams();
  const docId = params.get('doc');
  const active = params.get('history') === 'true' && !!docId;
  const seqParam = params.get('v');
  const selectedSeq = seqParam != null && seqParam !== '' ? Number(seqParam) : null;

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
      setParams((prev) => {
        prev.set('history', 'true');
        prev.set('v', String(seq));
        return prev;
      });
    },
    [setParams],
  );

  return { active, docId, selectedSeq, enter, exit, select };
}
