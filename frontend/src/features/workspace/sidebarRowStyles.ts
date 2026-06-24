// Shared sidebar-row chrome so WorkspaceSidebar and PagesSection rows match on hover/selected/focus.
export const sidebarRow = {
  base: 'flex items-center gap-2.5 rounded-2 px-2.25 py-1.5 text-body-s no-underline focus-visible:[outline:1px_solid_var(--border-focus)]',
  default: 'text-primary hover:bg-surface-secondary-hover hover:text-primary',
  selected:
    'bg-surface-secondary-active font-semibold text-primary hover:bg-surface-secondary-active hover:text-primary',
};
