import type {
  AuthenticatedSession,
  AuthenticatedUser,
} from "$lib/server/auth/sessions";
import type { TelegramWebApp } from "$lib/telegram/web-app";

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp;
    };
  }

  namespace App {
    interface Error {
      code: string;
      message: string;
    }

    interface Locals {
      requestId: string;
      session: AuthenticatedSession | null;
      user: AuthenticatedUser | null;
    }
  }
}

export {};
