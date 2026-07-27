import { describe, expect, it } from "vitest";

import {
  getSectionIndex,
  resolveSwipe,
} from "../../src/lib/features/navigation/navigation";

describe("section navigation", () => {
  it("opens home by default and resolves explicit sections", () => {
    expect(getSectionIndex(null)).toBe(1);
    expect(getSectionIndex("unknown")).toBe(1);
    expect(getSectionIndex("support")).toBe(0);
    expect(getSectionIndex("profile")).toBe(2);
  });

  it("switches one adjacent section after a horizontal swipe", () => {
    expect(resolveSwipe(1, -80, 390)).toBe(2);
    expect(resolveSwipe(1, 80, 390)).toBe(0);
  });

  it("keeps the section for short swipes and at boundaries", () => {
    expect(resolveSwipe(1, 40, 390)).toBe(1);
    expect(resolveSwipe(0, 100, 390)).toBe(0);
    expect(resolveSwipe(2, -100, 390)).toBe(2);
  });
});
