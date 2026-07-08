import { useDocHistory } from '../../../hooks/usePages';
import { useHistoryMode } from './useHistoryMode';

// One source of "which version is showing", shared by VersionsSection and DocHistoryView: effectiveSeq = ?v seq else newest session's lastSeq; session = the matching session, else undefined.
export function useVersionSelection(docId: string) {
  const { selectedSeq } = useHistoryMode();
  const { data, isLoading, isError } = useDocHistory(docId);

  const sessions = data?.sessions ?? [];
  const effectiveSeq = selectedSeq ?? sessions[0]?.lastSeq ?? null;
  const session =
    effectiveSeq != null ? sessions.find((s) => s.lastSeq === effectiveSeq) : undefined;

  return { sessions, isLoading, isError, effectiveSeq, session };
}
