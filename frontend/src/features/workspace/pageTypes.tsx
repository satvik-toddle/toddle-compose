import { PageFoldPortraitOutlined, SheetsOutlined } from '@toddle-edu/ds-icons';
import type { DocumentType } from '../../types/api';

// The page kinds a user can create — the single source for every "new page"
// dropdown (Doc vs Sheet). `Icon` is the component so each call site sizes it;
// `description` is the one-line subtext shown under the label.
export const PAGE_TYPES = [
  {
    type: 'DOC',
    label: 'Doc',
    description: 'Write notes, docs, and rich text',
    Icon: PageFoldPortraitOutlined,
  },
  {
    type: 'SHEET',
    label: 'Sheet',
    description: 'Organize data in rows and columns',
    Icon: SheetsOutlined,
  },
] satisfies ReadonlyArray<{
  type: DocumentType;
  label: string;
  description: string;
  Icon: typeof PageFoldPortraitOutlined;
}>;
