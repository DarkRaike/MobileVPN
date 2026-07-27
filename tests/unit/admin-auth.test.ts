import { describe, expect, it } from "vitest";

import { isAdminUser, requireAdminUser } from "../../src/lib/server/auth/admin";
import type { AuthenticatedUser } from "../../src/lib/server/auth/sessions";

const user: AuthenticatedUser = {
  firstName: "Daniil",
  id: "1f69ba44-73b6-447d-811f-69cdd0bf7f45",
  languageCode: "ru",
  lastName: null,
  photoUrl: null,
  telegramUserId: "123456789",
  username: "darkraike",
};

describe("admin authorization", () => {
  it("uses only the authenticated Telegram user ID", () => {
    expect(isAdminUser(user, "123456789")).toBe(true);
    expect(isAdminUser(user, "987654321")).toBe(false);
    expect(isAdminUser(null, "123456789")).toBe(false);
  });

  it("rejects an authenticated non-admin user", () => {
    expect(() => requireAdminUser(user, "987654321")).toThrowError(
      expect.objectContaining({
        status: 403,
      }),
    );
  });

  it("requires a server-authenticated user", () => {
    expect(() => requireAdminUser(null, "123456789")).toThrowError(
      expect.objectContaining({
        status: 401,
      }),
    );
  });
});
