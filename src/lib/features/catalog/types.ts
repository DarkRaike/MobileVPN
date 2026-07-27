export interface CatalogPlan {
  currency: string;
  description: string | null;
  durationDays: number;
  id: string;
  isFeatured: boolean;
  name: string;
  priceStars: number;
  sortOrder: number;
}

export interface FaqItem {
  answer: string;
  id: string;
  question: string;
  sortOrder: number;
}

export interface PromoCodeFeedback {
  applicablePlanIds: string[];
  code: string;
  discountType: "fixed" | "percent";
  discountValue: number;
  preview: Array<{
    discountStars: number;
    planId: string;
    totalStars: number;
  }>;
}

export interface AppActionFeedback {
  action?: "promo" | "purchase" | "support";
  code?: string;
  invoiceUrl?: string;
  message?: string;
  ok?: boolean;
  orderId?: string;
  promoCode?: PromoCodeFeedback;
  publicNumber?: string;
  retryAfterSeconds?: number;
}
