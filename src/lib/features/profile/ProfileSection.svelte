<script lang="ts">
  import { resolve } from "$app/paths";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import UserAvatar from "$lib/components/UserAvatar.svelte";
  import type { AppActionFeedback } from "$lib/features/catalog/types";
  import type { AuthenticatedUser } from "$lib/server/auth/sessions";
  import type { getProfileOverview } from "$lib/server/modules/subscriptions/profile";

  let {
    feedback,
    isAdmin,
    onPurchase,
    profileOverview,
    sessionExpiresAt,
    user,
  }: {
    feedback: AppActionFeedback | null;
    isAdmin: boolean;
    onPurchase: () => void;
    profileOverview: Awaited<ReturnType<typeof getProfileOverview>>;
    sessionExpiresAt: Date | null;
    user: AuthenticatedUser | null;
  } = $props();

  const isAuthenticated = $derived(user !== null);
  const fullName = $derived(
    user
      ? [user.firstName, user.lastName].filter(Boolean).join(" ")
      : "Инкогнито",
  );
  const username = $derived(user?.username ? `@${user.username}` : "Инкогнито");
  const sessionExpiry = $derived(
    sessionExpiresAt
      ? new Intl.DateTimeFormat("ru-RU", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }).format(sessionExpiresAt)
      : null,
  );
  const subscription = $derived(profileOverview.subscription);
  const purchaseHistory = $derived(profileOverview.purchaseHistory);

  function formatDate(value: Date): string {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
      year: "numeric",
    }).format(value);
  }

  function paymentStatusLabel(status: string | null): string {
    const labels: Record<string, string> = {
      cancelled: "Отменён",
      failed: "Ошибка",
      pending: "Ожидает оплаты",
      refunded: "Возвращён",
      succeeded: "Оплачено",
    };

    return status ? (labels[status] ?? "Обрабатывается") : "Без платежа";
  }

  function provisioningStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      failed: "Повтор выдачи",
      not_started: "Не начата",
      pending: "Создаётся",
      processing: "Создаётся",
      succeeded: "Доступ выдан",
    };

    return labels[status] ?? "Обрабатывается";
  }
</script>

<header class="mb-6">
  <h1
    id="section-heading-profile"
    class="text-[30px] font-semibold tracking-[-0.03em]"
    tabindex="-1"
  >
    Профиль
  </h1>
</header>

<article class="profile-card surface mb-6 rounded-[26px] p-4">
  <div class="flex items-center gap-3.5">
    <UserAvatar {user} size="large" />
    <div class="min-w-0 flex-1">
      <h2 class="truncate text-[19px] font-semibold">{fullName}</h2>
      <p class="mt-0.5 truncate text-sm text-[color:var(--color-muted)]">
        {username}
      </p>
    </div>
    {#if isAdmin}
      <a
        class="grid min-h-11 min-w-11 place-items-center rounded-[15px] bg-[color:var(--color-card-raised)] text-[color:var(--color-accent)]"
        href={resolve("/admin")}
        aria-label="Открыть административный раздел"
      >
        <AppIcon name="lock" size={21} />
      </a>
    {/if}
  </div>
</article>

<p
  class="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-[color:var(--color-muted)] uppercase"
>
  Подписка
</p>
<article class="surface mb-6 rounded-[26px] p-4">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      {#if subscription.status === "active"}
        <h2 class="truncate text-[20px] font-semibold">
          {subscription.planName}
        </h2>
        <p class="mt-1 text-sm text-[color:var(--color-muted)]">
          Активна до {formatDate(subscription.expiresAt)}
        </p>
      {:else if subscription.status === "provisioning"}
        <h2 class="text-[20px] font-semibold">Доступ создаётся</h2>
        <p class="mt-1 text-sm leading-5 text-[color:var(--color-muted)]">
          Оплата получена. Мы завершаем выдачу подписки.
        </p>
      {:else if subscription.status === "provisioning_failed"}
        <h2 class="text-[20px] font-semibold">Доступ создаётся</h2>
        <p class="mt-1 text-sm leading-5 text-[color:var(--color-muted)]">
          Временно не удалось создать доступ. Повторим автоматически.
        </p>
      {:else}
        <h2 class="text-[20px] font-semibold">Не активна</h2>
        <p class="mt-1 text-sm text-[color:var(--color-muted)]">
          Действует до —
        </p>
      {/if}
    </div>
    <span
      class:status-active={subscription.status === "active"}
      class="status-pill"
    >
      {subscription.status === "active" ? "Активна" : "Нет плана"}
    </span>
  </div>

  <div class="mt-4 grid grid-cols-2 gap-2">
    <button
      class="plan-action plan-action-primary"
      type="button"
      onclick={onPurchase}
    >
      Продлить
    </button>
    {#if subscription.status === "active"}
      <a class="plan-action grid place-items-center" href={resolve("/setup")}>
        Настроить
      </a>
    {:else}
      <button class="plan-action" type="button" onclick={onPurchase}>
        Выбрать тариф
      </button>
    {/if}
  </div>
</article>

{#if isAuthenticated}
  <div class="mb-2.5 flex items-center justify-between">
    <h2
      class="text-[11px] font-semibold tracking-[0.12em] text-[color:var(--color-muted)] uppercase"
    >
      История покупок
    </h2>
    <span class="text-xs text-[color:var(--color-muted)]">
      {purchaseHistory.length}
    </span>
  </div>

  {#if purchaseHistory.length === 0}
    <article class="surface mb-6 rounded-[24px] p-5">
      <p class="text-sm font-semibold">Покупок пока нет</p>
      <p class="mt-1 text-xs leading-5 text-[color:var(--color-muted)]">
        Здесь появятся статусы оплаты и выдачи доступа.
      </p>
    </article>
  {:else}
    <div class="surface mb-6 rounded-[27px] p-4">
      {#each purchaseHistory as purchase, index (purchase.id)}
        <article
          class:border-b={index < purchaseHistory.length - 1}
          class="flex items-start gap-3 border-[color:var(--color-border)] py-3 first:pt-0 last:pb-0"
        >
          <span
            class="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[color:color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-[color:var(--color-accent)]"
          >
            <AppIcon name="spark" size={20} />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate font-semibold">{purchase.planName}</p>
            <p class="mt-0.5 text-xs text-[color:var(--color-muted)]">
              {formatDate(purchase.createdAt)}
            </p>
            <p class="mt-1 text-[11px] text-[color:var(--color-muted)]">
              {paymentStatusLabel(purchase.paymentStatus)} ·
              {provisioningStatusLabel(purchase.provisioningStatus)}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p class="font-semibold">{purchase.totalStars} ⭐</p>
            {#if purchase.discountStars > 0}
              <p class="mt-0.5 text-[11px] text-[color:var(--color-accent)]">
                −{purchase.discountStars} ⭐
              </p>
            {:else}
              <p class="mt-0.5 text-[11px] text-[color:var(--color-muted)]">
                {purchase.currency}
              </p>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}

  <p
    class="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-[color:var(--color-muted)] uppercase"
  >
    Сессия
  </p>
  <article class="surface mb-6 rounded-[24px] p-4">
    <div class="flex items-center gap-3">
      <span
        class="grid h-11 w-11 shrink-0 place-items-center rounded-[15px] bg-[color:var(--color-card-raised)] text-[color:var(--color-accent)]"
      >
        <AppIcon name="lock" size={21} />
      </span>
      <div class="min-w-0 flex-1">
        <p class="font-semibold">Telegram подтверждён</p>
        <p class="mt-0.5 truncate text-xs text-[color:var(--color-muted)]">
          {sessionExpiry ? `До ${sessionExpiry} UTC` : "Защищённая сессия"}
        </p>
      </div>
      <span class="h-2.5 w-2.5 rounded-full bg-[color:var(--color-accent)]"
      ></span>
    </div>
  </article>

  {#if isAdmin}
    <a
      class="mb-3 flex min-h-12 w-full items-center justify-between rounded-[16px] bg-[color:var(--color-accent)] px-4 py-3 text-sm font-semibold text-[color:var(--color-button-text)]"
      href={resolve("/admin")}
    >
      Административный раздел
      <AppIcon name="arrow" size={20} />
    </a>
  {/if}

  <form method="POST" action="?/logout">
    <button
      class="min-h-11 w-full rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-3 text-sm font-semibold transition active:scale-[0.985]"
      type="submit"
    >
      Выйти из аккаунта
    </button>
  </form>
{/if}

{#if feedback?.action === "promo"}
  <p class="sr-only" role="status">{feedback.message}</p>
{/if}
