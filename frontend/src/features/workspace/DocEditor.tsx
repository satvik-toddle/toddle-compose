// Placeholder for the collaborative RTC editor, which ships in its own PR
// (part 6/6). PagesPanel lazy-imports this module; mirroring the real
// component's export name and props keeps the app building and navigable
// while the editor surface is reviewed separately.
export function DocEditor({ docId }: { docId: string; canEdit?: boolean }) {
  return (
    <main className="ws-main">
      <div className="ws-scroll" style={{ padding: 24, color: 'var(--text-secondary-enabled)' }}>
        Editor coming soon — document {docId}
      </div>
    </main>
  );
}
