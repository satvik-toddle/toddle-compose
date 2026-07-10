// True on Apple devices — used to show the ⌘ vs Ctrl modifier in shortcut hints.
export const isAppleDevice =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);

export const commandModifierKey = isAppleDevice ? '⌘' : 'Ctrl';
