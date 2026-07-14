import { ChevronRightOutlined } from '@toddle-edu/ds-icons';
import { Tag } from '@toddle-edu/ds-web';
import type { DocumentDto, SearchResultDto } from '../../../types/api';
import { pageTypeIcon } from '../../workspace/pageTypes';
import { buildBreadcrumbTrail } from '../../workspace/topbar/ancestorTrail';
import { Hit } from './Hit';

// One search hit. `wsDocs` is the in-workspace document cache used to derive the
// ancestor trail; global rows use the row's own workspace instead.
export function ResultRow({
  doc,
  q,
  active,
  isGlobal,
  wsDocs,
  onClick,
}: {
  doc: SearchResultDto;
  q: string;
  active: boolean;
  isGlobal: boolean;
  wsDocs: DocumentDto[];
  onClick: () => void;
}) {
  const PageIcon = pageTypeIcon(doc.type);

  // In-workspace path = ancestor folder/doc trail (excludes the doc itself).
  // TODO: fold in the containing folder name (needs useFolders) for top-level docs.
  const ancestorTrail = isGlobal
    ? ''
    : buildBreadcrumbTrail(doc, wsDocs)
        .slice(0, -1)
        .map((s) => s.title)
        .join(' / ');

  return (
    <button type="button" className={`sr${active ? ' on' : ''}`} onClick={onClick}>
      <span className="sr-ic">
        {doc.icon ? doc.icon : <PageIcon className="ic" style={{ width: 18, height: 18 }} aria-hidden />}
      </span>
      <div className="sr-body">
        <div className="sr-nm">
          <span>
            <Hit t={doc.title} q={q} />
          </span>
          {doc.match === 'title' && (
            <span className="sr-badge">
              <Tag color="teal" size="small">
                Title
              </Tag>
            </span>
          )}
        </div>
        {doc.snippet && (
          // Shown for any row carrying a content hit — including title matches whose body also matches.
          <div className="sr-snip">
            …<Hit t={doc.snippet} q={q} />…
          </div>
        )}
        {/* Subtext = in-workspace ancestor trail only; workspace name is intentionally not shown. */}
        {!isGlobal && ancestorTrail && (
          <div className="sr-path">
            <span className="trail">{ancestorTrail}</span>
          </div>
        )}
      </div>
      <div className="sr-right">
        <ChevronRightOutlined className="ic sr-enter" aria-hidden />
      </div>
    </button>
  );
}
