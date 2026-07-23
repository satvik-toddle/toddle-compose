// The hover/selected/focus tokens every sidebar row shares. Kept separate so rows with a different
// layout (e.g. the two-line VersionsSection rows) can match the state chrome without copying literals.
export const sidebarRowState = {
  focus: 'focus-visible:[outline:1px_solid_var(--border-focus)]',
  hover: 'hover:bg-surface-secondary-hover',
  selected: 'bg-surface-secondary-active',
};

// Shared sidebar-row chrome so WorkspaceSidebar and PagesSection rows match on hover/selected/focus.
export const sidebarRow = {
  base: `flex items-center gap-2.5 rounded-2 px-2.25 py-1.5 text-body-s no-underline ${sidebarRowState.focus}`,
  default: `text-primary ${sidebarRowState.hover} hover:text-primary`,
  selected: `${sidebarRowState.selected} font-semibold text-primary hover:bg-surface-secondary-active hover:text-primary`,
};
