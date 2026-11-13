/** Active cards in a column (not archived). */
export function wipCount(cards) {
  return cards.filter((c) => !c.deleted).length;
}

/** Whether the column is at or over its WIP limit (`wipLimit` null → no limit). */
export function wipStatus(column, count) {
  const limit = column?.wipLimit;
  if (!limit || limit < 1) return { limit: null, over: false, at: false };
  return { limit, over: count > limit, at: count >= limit };
}
