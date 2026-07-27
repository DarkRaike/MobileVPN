import type {
  AuthenticatedSession,
  AuthenticatedUser,
} from "$lib/server/auth/sessions";

declare global {
  namespace App {
    interface Error {
      code: string;
      message: string;
    }

    interface Locals {
      session: AuthenticatedSession | null;
      user: AuthenticatedUser | null;
    }
  }
}

export {};
