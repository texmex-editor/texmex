// Mirrors server/Api/Models/TemplateModels.cs#TemplateCategories.Allowed.
// Keep in sync when adding categories. Backend exposes GET /api/templates/categories
// if you want runtime fetching instead — for now we hardcode for simpler UX
// (the list rarely changes and the dropdown shouldn't depend on a network round trip).
export const TEMPLATE_CATEGORIES = [
  'article',
  'report',
  'book',
  'presentation',
  'letter',
  'cv',
  'other',
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

// Acronyms that deserve their canonical casing instead of just first-letter
// capitalization. cv → CV is the obvious one; extend here if "ai" or similar
// ever get added to the allowlist.
const ACRONYMS = new Set(['cv']);

// Returns the user-visible label for a category slug. Storage is lowercase;
// display is Title Case (or all-caps for known acronyms).
//
// Falls back to 'Other' when the value is empty or null so badges never read
// as a stray blank space.
export function formatCategoryLabel(value?: string | null): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return 'Other';
  const lower = trimmed.toLowerCase();
  if (ACRONYMS.has(lower)) return lower.toUpperCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
