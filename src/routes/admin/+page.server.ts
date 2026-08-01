import { fail } from "@sveltejs/kit";

import { ApplicationError } from "$lib/server/application-error";
import { requireAdminUser } from "$lib/server/auth/admin";
import { getRuntimeConfig } from "$lib/server/config/runtime";
import { getDatabase } from "$lib/server/db/runtime";
import {
  createFaq,
  createPlan,
  createPromoCode,
  deactivatePlan,
  deactivatePromoCode,
  deleteFaq,
  deletePlan,
  deletePromoCode,
  listCatalogForAdmin,
  updateFaq,
  updatePlan,
  updatePromoCode,
} from "$lib/server/modules/catalog/catalog";
import { listOrdersForAdmin } from "$lib/server/modules/orders/orders";
import { getMarzban } from "$lib/server/integrations/marzban/runtime";
import { logEvent } from "$lib/server/observability/logger";
import {
  grantSubscription,
  listGrantsForAdmin,
} from "$lib/server/modules/subscriptions/grants";
import {
  provisionOrder,
  requeueProvisioningOrder,
} from "$lib/server/modules/subscriptions/provisioning";
import {
  listAuditLog,
  listSupportTickets,
  updateSupportTicketStatus,
  type SupportTicketStatus,
} from "$lib/server/modules/support/support";
import { consumeRateLimit } from "$lib/server/security/rate-limit";
import {
  assertFormPayloadSize,
  assertRequestSize,
  isValidationError,
  parseEntityId,
  parseFaqInput,
  parseGrantInput,
  parsePlanInput,
  parsePromoCodeInput,
  parseSupportStatus,
} from "$lib/server/validation/forms";

import type { Actions, PageServerLoad } from "./$types";

const ADMIN_FORM_MAXIMUM_BYTES = 64 * 1024;
const ADMIN_RATE_LIMIT = 60;
const ADMIN_RATE_LIMIT_WINDOW_SECONDS = 60;
const supportStatuses = new Set<SupportTicketStatus>([
  "new",
  "in_progress",
  "resolved",
]);

type AdminActionName =
  | "faq.create"
  | "faq.delete"
  | "faq.update"
  | "plan.create"
  | "plan.deactivate"
  | "plan.delete"
  | "plan.update"
  | "promo.create"
  | "promo.deactivate"
  | "promo.delete"
  | "promo.update"
  | "order.provisioning_retry"
  | "subscription.grant"
  | "support.status_update";

interface AdminActionEvent {
  getClientAddress(): string;
  locals: App.Locals;
  request: Request;
}

async function prepareAdminAction(event: AdminActionEvent): Promise<{
  adminUserId: string;
  database: Awaited<ReturnType<typeof getDatabase>>["database"];
  formData: FormData;
}> {
  const config = getRuntimeConfig();
  const admin = requireAdminUser(event.locals.user, config.telegramAdminUserId);
  const rateLimit = consumeRateLimit(
    `admin:${admin.id}:${event.getClientAddress()}`,
    ADMIN_RATE_LIMIT,
    ADMIN_RATE_LIMIT_WINDOW_SECONDS,
  );

  if (!rateLimit.allowed) {
    throw new ApplicationError(
      "ADMIN_RATE_LIMITED",
      "Слишком много действий. Повторите позже.",
    );
  }

  assertRequestSize(event.request, ADMIN_FORM_MAXIMUM_BYTES);
  const formData = await event.request.formData();
  assertFormPayloadSize(formData, ADMIN_FORM_MAXIMUM_BYTES);
  const { database } = await getDatabase();

  return {
    adminUserId: admin.id,
    database,
    formData,
  };
}

function adminActionError(action: AdminActionName, error: unknown) {
  if (error instanceof ApplicationError) {
    const status =
      error.code === "REQUEST_TOO_LARGE"
        ? 413
        : error.code === "ADMIN_RATE_LIMITED"
          ? 429
          : 400;

    return fail(status, {
      action,
      code: error.code,
      message: error.message,
      ok: false as const,
    });
  }

  if (isValidationError(error)) {
    return fail(400, {
      action,
      code: "FORM_INVALID",
      message: "Проверьте заполнение формы.",
      ok: false as const,
    });
  }

  logEvent("error", {
    action,
    errorCode: "ADMIN_MUTATION_FAILED",
    errorType: error instanceof Error ? error.name : "UnknownError",
  });

  return fail(500, {
    action,
    code: "ADMIN_MUTATION_FAILED",
    message: "Не удалось сохранить изменения.",
    ok: false as const,
  });
}

function parseTicketFilter(
  value: string | null,
): SupportTicketStatus | undefined {
  return value && supportStatuses.has(value as SupportTicketStatus)
    ? (value as SupportTicketStatus)
    : undefined;
}

export const load: PageServerLoad = async ({ locals, url }) => {
  const config = getRuntimeConfig();
  const admin = requireAdminUser(locals.user, config.telegramAdminUserId);
  const { database } = await getDatabase();
  const ticketStatus = parseTicketFilter(url.searchParams.get("ticketStatus"));
  const [catalog, tickets, auditLog, orders, grants] = await Promise.all([
    listCatalogForAdmin(database),
    listSupportTickets(database, ticketStatus),
    listAuditLog(database),
    listOrdersForAdmin(database),
    listGrantsForAdmin(database),
  ]);

  return {
    admin,
    auditLog,
    catalog,
    grants,
    orders,
    ticketStatus: ticketStatus ?? "all",
    tickets,
  };
};

export const actions = {
  createFaq: async (event) => {
    const action = "faq.create" as const;

    try {
      const context = await prepareAdminAction(event);
      const faq = await createFaq(
        context.database,
        context.adminUserId,
        parseFaqInput(context.formData),
      );

      return {
        action,
        entityId: faq.id,
        message: "FAQ создан.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  createPlan: async (event) => {
    const action = "plan.create" as const;

    try {
      const context = await prepareAdminAction(event);
      const plan = await createPlan(
        context.database,
        context.adminUserId,
        parsePlanInput(context.formData),
      );

      return {
        action,
        entityId: plan.id,
        message: "Тариф создан.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  createPromo: async (event) => {
    const action = "promo.create" as const;

    try {
      const context = await prepareAdminAction(event);
      const promoCode = await createPromoCode(
        context.database,
        context.adminUserId,
        parsePromoCodeInput(context.formData),
      );

      return {
        action,
        entityId: promoCode.id,
        message: "Промокод создан.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  grantAccess: async (event) => {
    const action = "subscription.grant" as const;

    try {
      const context = await prepareAdminAction(event);
      const input = parseGrantInput(context.formData);
      const config = getRuntimeConfig();

      // Without live operations the grant could never be provisioned, and the
      // paid order would keep the paid_without_subscription signal critical.
      if (
        !config.liveOperationsEnabled ||
        !config.subscriptionUrlEncryptionKey
      ) {
        throw new ApplicationError(
          "LIVE_OPERATIONS_DISABLED",
          "Выдача недоступна: включите ENABLE_LIVE_OPERATIONS.",
        );
      }

      const grant = await grantSubscription(context.database, {
        adminUserId: context.adminUserId,
        durationDays: input.durationDays,
        targetTelegramUserId: input.targetTelegramUserId,
      });

      // Provision straight away so the administrator sees the outcome; the
      // worker retries on its own schedule if Marzban is unavailable.
      const result = await provisionOrder(
        context.database,
        getMarzban(config),
        config.subscriptionUrlEncryptionKey,
        grant.orderId,
      );

      if (result.status === "failed") {
        // The order exists and stays retryable, so the administrator has to see
        // why Marzban refused it instead of a reassuring acceptance message.
        return {
          action,
          code: result.errorCode,
          entityId: grant.orderId,
          message:
            "Заказ создан, но Marzban не подтвердил выдачу. Повторите её в разделе «Заказы».",
          ok: false as const,
        };
      }

      return {
        action,
        entityId: grant.orderId,
        message:
          result.status === "applied"
            ? `Доступ выдан до ${grant.targetExpiresAt.toLocaleDateString("ru-RU")}.`
            : "Выдача принята. Доступ появится после подтверждения Marzban.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  retryProvisioning: async (event) => {
    const action = "order.provisioning_retry" as const;

    try {
      const context = await prepareAdminAction(event);
      const id = parseEntityId(context.formData);
      await requeueProvisioningOrder(
        context.database,
        id,
        new Date(),
        context.adminUserId,
      );

      return {
        action,
        entityId: id,
        message: "Заказ поставлен в очередь на безопасный повтор.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  deactivatePlan: async (event) => {
    const action = "plan.deactivate" as const;

    try {
      const context = await prepareAdminAction(event);
      const id = parseEntityId(context.formData);
      await deactivatePlan(context.database, context.adminUserId, id);

      return {
        action,
        entityId: id,
        message: "Тариф деактивирован.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  deactivatePromo: async (event) => {
    const action = "promo.deactivate" as const;

    try {
      const context = await prepareAdminAction(event);
      const id = parseEntityId(context.formData);
      await deactivatePromoCode(context.database, context.adminUserId, id);

      return {
        action,
        entityId: id,
        message: "Промокод деактивирован.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  deleteFaq: async (event) => {
    const action = "faq.delete" as const;

    try {
      const context = await prepareAdminAction(event);
      const id = parseEntityId(context.formData);
      await deleteFaq(context.database, context.adminUserId, id);

      return {
        action,
        entityId: id,
        message: "FAQ удалён.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  deletePlan: async (event) => {
    const action = "plan.delete" as const;

    try {
      const context = await prepareAdminAction(event);
      const id = parseEntityId(context.formData);
      await deletePlan(context.database, context.adminUserId, id);

      return {
        action,
        entityId: id,
        message: "Тариф удалён.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  deletePromo: async (event) => {
    const action = "promo.delete" as const;

    try {
      const context = await prepareAdminAction(event);
      const id = parseEntityId(context.formData);
      await deletePromoCode(context.database, context.adminUserId, id);

      return {
        action,
        entityId: id,
        message: "Промокод удалён.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  updateFaq: async (event) => {
    const action = "faq.update" as const;

    try {
      const context = await prepareAdminAction(event);
      const id = parseEntityId(context.formData);
      await updateFaq(
        context.database,
        context.adminUserId,
        id,
        parseFaqInput(context.formData),
      );

      return {
        action,
        entityId: id,
        message: "FAQ обновлён.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  updatePlan: async (event) => {
    const action = "plan.update" as const;

    try {
      const context = await prepareAdminAction(event);
      const id = parseEntityId(context.formData);
      await updatePlan(
        context.database,
        context.adminUserId,
        id,
        parsePlanInput(context.formData),
      );

      return {
        action,
        entityId: id,
        message: "Тариф обновлён.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  updatePromo: async (event) => {
    const action = "promo.update" as const;

    try {
      const context = await prepareAdminAction(event);
      const id = parseEntityId(context.formData);
      await updatePromoCode(
        context.database,
        context.adminUserId,
        id,
        parsePromoCodeInput(context.formData),
      );

      return {
        action,
        entityId: id,
        message: "Промокод обновлён.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
  updateTicketStatus: async (event) => {
    const action = "support.status_update" as const;

    try {
      const context = await prepareAdminAction(event);
      const input = parseSupportStatus(context.formData);
      await updateSupportTicketStatus(
        context.database,
        context.adminUserId,
        input.id,
        input.status,
      );

      return {
        action,
        entityId: input.id,
        message: "Статус обращения обновлён.",
        ok: true as const,
      };
    } catch (error) {
      return adminActionError(action, error);
    }
  },
} satisfies Actions;
