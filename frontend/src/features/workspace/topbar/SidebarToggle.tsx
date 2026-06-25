import s from '../WorkspaceLayout.module.scss';

// Coda / VS Code-style "panel-left" sidebar-toggle glyph (a rounded panel with a
// divider marking the side rail) — ds-icons has no sidebar/panel icon.
function SidebarToggleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <line x1="9" y1="4" x2="9" y2="20" />
    </svg>
  );
}

export function SidebarToggle({ onToggle }: Readonly<{ onToggle: () => void }>) {
  return (
    <button
      className={`ibtn ${s.tbSidebarToggle}`}
      onClick={onToggle}
      title="Toggle sidebar"
      aria-label="Toggle sidebar"
    >
      <SidebarToggleIcon />
    </button>
  );
}
