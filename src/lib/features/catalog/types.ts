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
  action?: "promo" | "support";
  code?: string;
  message?: string;
  ok?: boolean;
  promoCode?: PromoCodeFeedback;
  publicNumber?: string;
  retryAfterSeconds?: number;
}
