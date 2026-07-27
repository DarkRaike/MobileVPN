import { ApplicationError } from "../application-error";

export type OrderStatus =
  | "active"
  | "cancelled"
  | "paid"
  | "pending_payment"
  | "provisioning"
  | "provisioning_failed"
  | "refunded";

export type PaymentStatus =
  "cancelled" | "failed" | "pending" | "refunded" | "succeeded";

const orderTransitions: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  {
    active: ["refunded"],
    cancelled: [],
    paid: ["provisioning", "refunded"],
    pending_payment: ["cancelled", "paid"],
    provisioning: ["active", "provisioning_failed", "refunded"],
    provisioning_failed: ["provisioning", "refunded"],
    refunded: [],
  };

const paymentTransitions: Readonly<
  Record<PaymentStatus, readonly PaymentStatus[]>
> = {
  cancelled: [],
  failed: [],
  pending: ["cancelled", "failed", "succeeded"],
  refunded: [],
  succeeded: ["refunded"],
};

export function assertOrderTransition(
  current: OrderStatus,
  next: OrderStatus,
): void {
  if (current === next) {
    return;
  }

  if (!orderTransitions[current].includes(next)) {
    throw new ApplicationError(
      "ORDER_TRANSITION_INVALID",
      "Заказ нельзя перевести в выбранное состояние.",
    );
  }
}

export function assertPaymentTransition(
  current: PaymentStatus,
  next: PaymentStatus,
): void {
  if (current === next) {
    return;
  }

  if (!paymentTransitions[current].includes(next)) {
    throw new ApplicationError(
      "PAYMENT_TRANSITION_INVALID",
      "Платёж нельзя перевести в выбранное состояние.",
    );
  }
}
