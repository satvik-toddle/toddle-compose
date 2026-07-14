import { SearchOutlined } from '@toddle-edu/ds-icons';

// Pre-typing minimal prompt (both scopes). No recents, no data fetching.
export function SearchEmpty() {
  return (
    <div className="gs-empty">
      <SearchOutlined className="glyph" aria-hidden />
      <div className="prompt">Search docs by title or content</div>
      <div className="gs-tips">
        <span className="tip">Titles &amp; content both searched</span>
        <span className="tip">Only docs you can access appear</span>
      </div>
    </div>
  );
}
