export function markCurrentGuide<T extends { completed: boolean }>(
  guides: readonly T[]
): Array<T & { isCurrent: boolean }> {
  const currentIndex = guides.findIndex((guide) => !guide.completed);
  return guides.map((guide, index) => ({ ...guide, isCurrent: index === currentIndex }));
}
