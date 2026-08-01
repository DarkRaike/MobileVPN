export const sections = [
  { id: "support", label: "Поддержка" },
  { id: "home", label: "Главная" },
  { id: "profile", label: "Профиль" },
] as const;

export type SectionIndex = 0 | 1 | 2;

export function clampSectionIndex(index: number): SectionIndex {
  return Math.max(0, Math.min(2, Math.trunc(index))) as SectionIndex;
}

export function getSectionIndex(value: string | null): SectionIndex {
  const index = sections.findIndex((section) => section.id === value);
  return index === -1 ? 1 : (index as SectionIndex);
}

export function resolveSwipe(
  currentIndex: SectionIndex,
  deltaX: number,
  viewportWidth: number,
): SectionIndex {
  const threshold = Math.min(70, viewportWidth * 0.18);

  if (Math.abs(deltaX) <= threshold) {
    return currentIndex;
  }

  return clampSectionIndex(currentIndex + (deltaX < 0 ? 1 : -1));
}
