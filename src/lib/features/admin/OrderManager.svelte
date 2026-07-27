<script lang="ts">
  import { enhance } from "$app/forms";
  import type { SubmitFunction } from "@sveltejs/kit";

  import type { AdminOrder } from "./types";

  let { orders }: { orders: AdminOrder[] } = $props();
  let submittingOrderId = $state<string | null>(null);

  const enhanceRetry: SubmitFunction = ({ formData }) => {
    submittingOrderId = String(formData.get("id") ?? "");

    return async ({ update }) => {
      await update({ reset: false });
      submittingOrderId = null;
    };
  };

  function formatDate(date: Date): string {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date);
  }

  function paymentLabel(status: AdminOrder["paymentStatus"]): string {
    const labels: Record<NonNullable<AdminOrder["paymentStatus"]>, string> = {
      cancelled: "Отменён",
      failed: "Ошибка",
      pending: "Ожидает",
      refunded: "Возвращён",
      succeeded: "Оплачен",
    };

    return status ? labels[status] : "Нет платежа";
  }

  function provisioningLabel(status: AdminOrder["provisioningStatus"]): string {
    const labels: Record<AdminOrder["provisioningStatus"], string> = {
      failed: "Ошибка",
      not_started: "Не начат",
      pending: "В очереди",
      processing: "Выполняется",
      succeeded: "Выдан",
    };

    return labels[status];
  }
</script>

<section aria-labelledby="admin-orders-heading">
  <div class="mb-4 flex items-end justify-between gap-4">
    <div>
      <p class="admin-eyebrow">Операции</p>
      <h2 id="admin-orders-heading" class="text-2xl font-semibold">
        Заказы и выдача
      </h2>
    </div>
    <span class="admin-count">{orders.length}</span>
  </div>

  {#if orders.length === 0}
    <div class="admin-empty">Заказов пока нет.</div>
  {:else}
    <div class="space-y-3">
      {#each orders as order (order.id)}
        <article class="admin-card p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="font-semibold">{order.planName}</p>
              <p
                class="mt-1 font-mono text-xs break-all text-[color:var(--color-muted)]"
              >
                {order.id}
              </p>
            </div>
            <span
              class:status-active={order.provisioningStatus === "succeeded"}
              class="status-pill shrink-0"
            >
              {provisioningLabel(order.provisioningStatus)}
            </span>
          </div>

          <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div class="rounded-[14px] bg-[color:var(--color-card-raised)] p-3">
              <dt class="text-xs text-[color:var(--color-muted)]">
                Пользователь
              </dt>
              <dd class="mt-1 font-medium break-all">
                Telegram {order.telegramUserId}
              </dd>
            </div>
            <div class="rounded-[14px] bg-[color:var(--color-card-raised)] p-3">
              <dt class="text-xs text-[color:var(--color-muted)]">Платёж</dt>
              <dd class="mt-1 font-medium">
                {paymentLabel(order.paymentStatus)} · {order.totalStars}
                {order.currency}
              </dd>
            </div>
            <div
              class="col-span-2 rounded-[14px] bg-[color:var(--color-card-raised)] p-3"
            >
              <dt class="text-xs text-[color:var(--color-muted)]">
                Внешний ID платежа
              </dt>
              <dd class="mt-1 font-mono text-xs break-all">
                {order.chargeId ?? "Ещё не получен"}
              </dd>
            </div>
          </dl>

          <div
            class="mt-3 space-y-1 text-xs leading-5 text-[color:var(--color-muted)]"
          >
            <p>Создан: {formatDate(order.createdAt)} UTC</p>
            <p>Попыток выдачи: {order.provisioningAttempts}</p>
            {#if order.provisioningErrorCode}
              <p class="text-red-400">
                Безопасный код ошибки: {order.provisioningErrorCode}
              </p>
            {/if}
            {#if order.nextAttemptAt}
              <p>Следующий повтор: {formatDate(order.nextAttemptAt)} UTC</p>
            {/if}
          </div>

          {#if order.status === "provisioning_failed" && order.paymentStatus === "succeeded" && order.provisioningStatus === "failed"}
            <form
              method="POST"
              action="?/retryProvisioning"
              class="mt-4"
              use:enhance={enhanceRetry}
            >
              <input name="id" type="hidden" value={order.id} />
              <button
                class="admin-primary w-full"
                type="submit"
                disabled={submittingOrderId !== null}
              >
                {submittingOrderId === order.id
                  ? "Ставим в очередь…"
                  : "Повторить выдачу"}
              </button>
            </form>
          {/if}
        </article>
      {/each}
    </div>
  {/if}
</section>
