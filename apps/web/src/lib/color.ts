const PALETTE = ['#4f46e5', '#0ea5e9', '#16a34a', '#f59e0b', '#8b5cf6', '#14b8a6']

/** Deterministic per-user colour, stable across sessions and across processes. */
export function colorFor(userId: string): string {
  let hash = 0
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return PALETTE[hash % PALETTE.length]!
}
