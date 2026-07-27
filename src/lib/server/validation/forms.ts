import { Buffer } from "node:buffer";

import { z } from "zod";

import { ApplicationError } from "../application-error";
import { normalizePromoCode } from "../domain/promo-codes";
import type {
  FaqInput,
  PlanInput,
  PromoCodeInput,
} from "../modules/catalog/catalog";
import type {
  SupportTicketInput,
  SupportTicketStatus,
} from "../modules/support/support";

const entityIdSchema = z.string().uuid();
const optionalString = z
  .string()
  .trim()
  .transform((value) => (value ? value : null));
const optionalPositiveInteger = z
  .union([z.literal(""), z.coerce.number().int().positive().max(1_000_000)])
  .transform((value) => (value === "" ? null : value));

const planSchema = z.object({
  description: optionalString.pipe(z.string().max(500).nullable()),
  durationDays: z.coerce.number().int().min(1).max(365),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
  name: z.string().trim().min(1).max(120),
  priceStars: z.coerce.number().int().min(1).max(1_000_000),
  sortOrder: z.coerce.number().int().min(-10_000).max(10_000),
});

const promoCodeSchema = z
  .object({
    allowedPlanIds: z.array(entityIdSchema).max(100),
    codeNormalized: z
      .string()
      .transform(normalizePromoCode)
      .pipe(z.string().regex(/^[A-Z0-9_-]{3,32}$/)),
    discountType: z.enum(["fixed", "percent"]),
    discountValue: z.coerce.number().int().positive().max(1_000_000),
    endsAt: z.date().nullable(),
    isActive: z.boolean(),
    maxUses: optionalPositiveInteger,
    maxUsesPerUser: optionalPositiveInteger,
    startsAt: z.date().nullable(),
  })
  .superRefine((value, context) => {
    if (value.discountType === "percent" && value.discountValue > 100) {
      context.addIssue({
        code: "custom",
        message: "Процентная скидка не может быть больше 100.",
        path: ["discountValue"],
      });
    }

    if (
      value.startsAt &&
      value.endsAt &&
      value.startsAt.getTime() >= value.endsAt.getTime()
    ) {
      context.addIssue({
        code: "custom",
        message: "Дата окончания должна быть позже даты начала.",
        path: ["endsAt"],
      });
    }

    if (
      value.maxUses !== null &&
      value.maxUsesPerUser !== null &&
      value.maxUsesPerUser > value.maxUses
    ) {
      context.addIssue({
        code: "custom",
        message: "Лимит на пользователя не может превышать общий лимит.",
        path: ["maxUsesPerUser"],
      });
    }
  });

const faqSchema = z.object({
  answer: z.string().trim().min(1).max(10_000),
  isPublished: z.boolean(),
  question: z.string().trim().min(3).max(240),
  sortOrder: z.coerce.number().int().min(-10_000).max(10_000),
});

const supportTicketSchema = z.object({
  message: z.string().trim().min(10).max(4_000),
  subject: z.string().trim().min(3).max(120),
});

const promoApplicationSchema = z.object({
  code: z
    .string()
    .transform(normalizePromoCode)
    .pipe(z.string().regex(/^[A-Z0-9_-]{3,32}$/)),
});

const supportStatusSchema = z.enum(["new", "in_progress", "resolved"]);

function getRequiredString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string") {
    throw new ApplicationError("FORM_INVALID", "Проверьте заполнение формы.");
  }

  return value;
}

function getStringValues(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string");
}

function hasCheckbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function parseUtcDate(value: string): Date | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    throw new ApplicationError("FORM_DATE_INVALID", "Некорректная дата.");
  }

  const parsed = new Date(`${trimmed}:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    throw new ApplicationError("FORM_DATE_INVALID", "Некорректная дата.");
  }

  return parsed;
}

export function assertRequestSize(
  request: Request,
  maximumBytes: number,
): void {
  const rawContentLength = request.headers.get("content-length");

  if (!rawContentLength) {
    return;
  }

  const contentLength = Number(rawContentLength);

  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > maximumBytes
  ) {
    throw new ApplicationError(
      "REQUEST_TOO_LARGE",
      "Размер запроса превышает допустимый.",
    );
  }
}

export function assertFormPayloadSize(
  formData: FormData,
  maximumBytes: number,
): void {
  let totalBytes = 0;

  for (const [key, value] of formData) {
    if (typeof value !== "string") {
      throw new ApplicationError(
        "FORM_FILE_UNSUPPORTED",
        "Файлы в этой форме не поддерживаются.",
      );
    }

    totalBytes += Buffer.byteLength(key, "utf8");
    totalBytes += Buffer.byteLength(value, "utf8");
  }

  if (totalBytes > maximumBytes) {
    throw new ApplicationError(
      "REQUEST_TOO_LARGE",
      "Размер запроса превышает допустимый.",
    );
  }
}

export function parseEntityId(formData: FormData): string {
  return entityIdSchema.parse(getRequiredString(formData, "id"));
}

export function parsePlanInput(formData: FormData): PlanInput {
  return {
    ...planSchema.parse({
      description: getRequiredString(formData, "description"),
      durationDays: getRequiredString(formData, "durationDays"),
      isActive: hasCheckbox(formData, "isActive"),
      isFeatured: hasCheckbox(formData, "isFeatured"),
      name: getRequiredString(formData, "name"),
      priceStars: getRequiredString(formData, "priceStars"),
      sortOrder: getRequiredString(formData, "sortOrder"),
    }),
    currency: "XTR",
  };
}

export function parsePromoCodeInput(formData: FormData): PromoCodeInput {
  const parsed = promoCodeSchema.parse({
    allowedPlanIds: getStringValues(formData, "allowedPlanIds"),
    codeNormalized: getRequiredString(formData, "code"),
    discountType: getRequiredString(formData, "discountType"),
    discountValue: getRequiredString(formData, "discountValue"),
    endsAt: parseUtcDate(getRequiredString(formData, "endsAt")),
    isActive: hasCheckbox(formData, "isActive"),
    maxUses: getRequiredString(formData, "maxUses"),
    maxUsesPerUser: getRequiredString(formData, "maxUsesPerUser"),
    startsAt: parseUtcDate(getRequiredString(formData, "startsAt")),
  });

  return {
    ...parsed,
    currency: parsed.discountType === "fixed" ? "XTR" : null,
  };
}

export function parseFaqInput(formData: FormData): FaqInput {
  return faqSchema.parse({
    answer: getRequiredString(formData, "answer"),
    isPublished: hasCheckbox(formData, "isPublished"),
    question: getRequiredString(formData, "question"),
    sortOrder: getRequiredString(formData, "sortOrder"),
  });
}

export function parseSupportTicketInput(
  formData: FormData,
): SupportTicketInput {
  return supportTicketSchema.parse({
    message: getRequiredString(formData, "message"),
    subject: getRequiredString(formData, "subject"),
  });
}

export function parsePromoApplication(formData: FormData): { code: string } {
  return promoApplicationSchema.parse({
    code: getRequiredString(formData, "code"),
  });
}

export function parseSupportStatus(formData: FormData): {
  id: string;
  status: SupportTicketStatus;
} {
  return {
    id: parseEntityId(formData),
    status: supportStatusSchema.parse(getRequiredString(formData, "status")),
  };
}

export function isValidationError(error: unknown): error is z.ZodError {
  return error instanceof z.ZodError;
}
