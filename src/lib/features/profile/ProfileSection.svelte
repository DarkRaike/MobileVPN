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
      ? [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          "Пользователь"
      : "Инкогнито",
  );
  const username = $derived(user?.username ? `@${user.username}` : "Инкогнито");
  const sessionExpiry = $derived(
    sessionExpiresAt
      ? new Intl.DateTimeFormat("ru-RU", {
          dateStyle: "short",
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

<header class="mb-5">
  <h1 id="section-heading-profile" class="lg-h1" tabindex="-1">Профиль</h1>
</header>

<article class="surface flex items-center gap-3.5 p-[18px]">
  <UserAvatar {user} size="large" />
  <div class="min-w-0 flex-1">
    <h2 class="m-0 truncate text-[19px] font-medium">{fullName}</h2>
    <p class="mt-[3px] mb-0 truncate text-[13.5px] text-[color:var(--muted)]">
      {username}
    </p>
  </div>
  {#if isAdmin}
    <a
      class="lg-btn-glass h-11 min-h-11 w-11 shrink-0 rounded-full p-0"
      href={resolve("/admin")}
      aria-label="Открыть административный раздел"
    >
      <AppIcon name="lock" size={20} />
    </a>
  {/if}
</article>

<h2 class="lg-eyebrow mx-0.5 mt-5 mb-2.5">Подписка</h2>
<article class="surface p-[18px]">
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0">
      {#if subscription.status === "active"}
        <h3 class="m-0 truncate text-[20px] font-medium tracking-[-0.02em]">
          {subscription.planName}
        </h3>
        <p class="mt-1.5 mb-0 text-[13px] text-[color:var(--muted)]">
          Активна до {formatDate(subscription.expiresAt)}
        </p>
      {:else if subscription.status === "provisioning"}
        <h3 class="m-0 text-[20px] font-medium tracking-[-0.02em]">
          Доступ создаётся
        </h3>
        <p class="mt-1.5 mb-0 text-[13px] leading-5 text-[color:var(--muted)]">
          Оплата получена, завершаем выдачу
        </p>
      {:else if subscription.status === "provisioning_failed"}
        <h3 class="m-0 text-[20px] font-medium tracking-[-0.02em]">
          Доступ создаётся
        </h3>
        <p class="mt-1.5 mb-0 text-[13px] leading-5 text-[color:var(--muted)]">
          Временно не удалось создать доступ. Повторим автоматически.
        </p>
      {:else}
        <h3 class="m-0 text-[20px] font-medium tracking-[-0.02em]">
          Не активна
        </h3>
        <p class="mt-1.5 mb-0 text-[13px] text-[color:var(--muted)]">
          Действует до —
        </p>
      {/if}
    </div>
    <span
      class:status-active={subscription.status === "active"}
      class="status-pill"
    >
      {subscription.status === "active"
        ? "Активна"
        : subscription.status === "provisioning" ||
            subscription.status === "provisioning_failed"
          ? "Создаётся"
          : "Нет плана"}
    </span>
  </div>

  <div class="mt-4 grid grid-cols-2 gap-[9px]">
    <button class="lg-btn-accent" type="button" onclick={onPurchase}>
      Продлить
    </button>
    {#if subscription.status === "active"}
      <a class="lg-btn-glass" href={resolve("/setup")}>Настроить</a>
    {:else}
      <button class="lg-btn-glass" type="button" onclick={onPurchase}>
        Выбрать тариф
      </button>
    {/if}
  </div>
</article>

{#if isAuthenticated}
  <h2 class="lg-eyebrow mx-0.5 mt-5 mb-2.5">История покупок</h2>

  {#if purchaseHistory.length === 0}
    <article class="lg-list px-4 py-[13px]">
      <p class="m-0 text-sm font-medium">Покупок пока нет</p>
      <p class="mt-1 mb-0 text-[11.5px] leading-5 text-[color:var(--muted)]">
        Здесь появятся статусы оплаты и выдачи доступа.
      </p>
    </article>
  {:else}
    <div class="lg-list px-4 py-1.5">
      {#each purchaseHistory as purchase (purchase.id)}
        <article class="history-row">
          <span
            class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[color:color-mix(in_srgb,var(--accent)_22%,transparent)] text-[color:var(--accent-deep)]"
          >
            <AppIcon name="spark" size={18} />
          </span>
          <div class="min-w-0 flex-1">
            <p class="m-0 truncate text-sm font-medium">{purchase.planName}</p>
            <p class="mt-[3px] mb-0 text-[11.5px] text-[color:var(--muted)]">
              {formatDate(purchase.createdAt)} · {paymentStatusLabel(
                purchase.paymentStatus,
              )} · {provisioningStatusLabel(purchase.provisioningStatus)}
            </p>
          </div>
          <div class="shrink-0 text-right">
            <p class="m-0 text-sm font-medium whitespace-nowrap">
              {purchase.totalStars} ⭐
            </p>
            {#if purchase.discountStars > 0}
              <p
                class="mt-[3px] mb-0 text-[11px] text-[color:var(--accent-deep)]"
              >
                −{purchase.discountStars} ⭐
              </p>
            {/if}
          </div>
        </article>
      {/each}
    </div>
  {/if}

  <div class="session-row mt-5">
    <span class="lg-icon-badge h-10 w-10">
      <AppIcon name="lock" size={18} />
    </span>
    <div class="min-w-0 flex-1">
      <p class="m-0 text-[13.5px] font-medium">Telegram подтверждён</p>
      <p class="mt-[3px] mb-0 truncate text-[11.5px] text-[color:var(--muted)]">
        {sessionExpiry ? `До ${sessionExpiry} UTC` : "Сессия защищена"}
      </p>
    </div>
    <span class="h-[9px] w-[9px] shrink-0 rounded-full bg-[color:var(--accent)]"
    ></span>
  </div>

  {#if isAdmin}
    <a
      class="lg-btn-accent mt-5 flex w-full items-center justify-between px-5"
      href={resolve("/admin")}
    >
      Административный раздел
      <AppIcon name="arrow" size={19} />
    </a>
  {/if}

  <form class="mt-5" method="POST" action="?/logout">
    <button class="lg-btn-glass w-full" type="submit">
      Выйти из аккаунта
    </button>
  </form>
{/if}

{#if feedback?.action === "promo"}
  <p class="sr-only" role="status">{feedback.message}</p>
{/if}
