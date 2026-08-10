// Classname joiner with Tailwind-aware conflict resolution (clsx + tailwind-merge).
// tailwind-merge only knows Tailwind's default scale, so we register the two DS
// families it mishandles: text-size-* (else read as a text color, dropping a
// co-applied color) and numeric rounded-* (else not deduped). Values mirror
// tailwind.config.js — keep in sync.
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

export type { ClassValue };

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        { text: [{ size: ['25', '50', '75', '100', '200', '300', '400', '500', '600', '700', '800'] }] },
      ],
    },
    theme: {
      radius: ['0', '0.5', '0.625', '0.75', '1', '1.5', '2', '2.5', '3', '4'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
