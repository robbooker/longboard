export type ChatMembership = 'LB' | 'SS';
/** Canonical display order, independent of provider order; reject unknown labels. */
export function membershipLabels(value: unknown): ChatMembership[] {
  if (!Array.isArray(value)) return [];
  return (['LB', 'SS'] as const).filter(label => value.includes(label));
}
