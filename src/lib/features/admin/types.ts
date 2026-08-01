export interface AdminPlan {
  createdAt: Date;
  currency: string;
  description: string | null;
  durationDays: number;
  id: string;
  isActive: boolean;
  isFeatured: boolean;
  name: string;
  priceStars: number;
  sortOrder: number;
  updatedAt: Date;
}

export interface AdminPromoCode {
  allowedPlanIds: string[];
  codeNormalized: string;
  createdAt: Date;
  currency: string | null;
  discountType: "fixed" | "percent";
  discountValue: number;
  endsAt: Date | null;
  id: string;
  isActive: boolean;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  startsAt: Date | null;
  updatedAt: Date;
}

export interface AdminFaq {
  answer: string;
  createdAt: Date;
  id: string;
  isPublished: boolean;
  question: string;
  sortOrder: number;
  updatedAt: Date;
}

export interface AdminTicket {
  createdAt: Date;
  firstName: string;
  id: string;
  lastName: string | null;
  message: string;
  publicNumber: string;
  resolvedAt: Date | null;
  status: "in_progress" | "new" | "resolved";
  subject: string;
  telegramDeliveryStatus: "failed" | "pending" | "sent";
  telegramMessageId: string | null;
  telegramUserId: string;
  username: string | null;
}

export interface AdminOrder {
  chargeId: string | null;
  createdAt: Date;
  currency: string;
  id: string;
  nextAttemptAt: Date | null;
  paymentId: string | null;
  paymentStatus:
    "cancelled" | "failed" | "pending" | "refunded" | "succeeded" | null;
  planName: string;
  provisioningAttempts: number;
  provisioningErrorCode: string | null;
  provisioningStatus:
    "failed" | "not_started" | "pending" | "processing" | "succeeded";
  source: "admin_grant" | "purchase";
  status:
    | "active"
    | "cancelled"
    | "paid"
    | "pending_payment"
    | "provisioning"
    | "provisioning_failed"
    | "refunded";
  telegramUserId: string;
  totalStars: number;
}

export interface AdminAuditRecord {
  action: string;
  adminUserId: string;
  afterJson: string | null;
  beforeJson: string | null;
  createdAt: Date;
  entityId: string;
  entityType: string;
  id: string;
}

export interface AdminActionFeedback {
  action?: string;
  code?: string;
  entityId?: string;
  message?: string;
  ok?: boolean;
}
