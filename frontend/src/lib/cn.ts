// Classname joiner with Tailwind conflict resolution. clsx handles conditional
// inputs (strings, arrays, objects, falsy values); tailwind-merge dedupes
// conflicting utilities so a caller's `px-6` wins over a component's `px-4`
// instead of both landing in the class list.
//
// NOTE: tailwind-merge only knows Tailwind's *default* scale, so DS custom-scale
// classes (gap-120, text-size-400, rounded-2, …) pass through without being
// merged against each other. That's fine for joining; if same-family DS-scale
// overrides ever need deduping, wrap with extendTailwindMerge to teach it the
// DS scale.
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export type { ClassValue };

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
