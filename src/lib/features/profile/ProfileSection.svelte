<script lang="ts">
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { onMount } from "svelte";

  import type { AuthenticatedUser } from "$lib/server/auth/sessions";
  import type { getProfileOverview } from "$lib/server/modules/subscriptions/profile";
  import type { AppActionFeedback } from "$lib/features/catalog/types";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import UserAvatar from "$lib/components/UserAvatar.svelte";

  let {
    feedback,
    isAdmin,
    onNavigate,
    profileOverview,
    sessionExpiresAt,
    user,
  }: {
    feedback: AppActionFeedback | null;
    isAdmin: boolean;
    onNavigate: (index: number) => void;
    profileOverview: Awaited<ReturnType<typeof getProfileOverview>>;
    sessionExpiresAt: Date | null;
    user: AuthenticatedUser;
  } = $props();

  let promoInput = $state("");
  let copyMessage = $state<string | null>(null);
  let now = $state(Date.now());
  let submittingPromo = $state(false);

  const fullName = $derived(
    [user.firstName, user.lastName].filter(Boolean).join(" "),
  );
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
  const remainingMilliseconds = $derived(
    subscription.status === "active"
      ? Math.max(0, subscription.expiresAt.getTime() - now)
      : 0,
  );
  const subscriptionProgress = $derived(
    subscription.status === "active"
      ? Math.max(
          0,
          Math.min(
            100,
            (remainingMilliseconds /
              (subscription.expiresAt.getTime() -
                subscription.startsAt.getTime())) *
              100,
          ),
        )
      : 0,
  );

  const enhancePromo: SubmitFunction = () => {
    submittingPromo = true;

    return async ({ update }) => {
      await update({ reset: false });
      submittingPromo = false;
    };
  };

  function formatDate(value: Date): string {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
      year: "numeric",
    }).format(value);
  }

  function formatRemaining(milliseconds: number): string {
    const totalHours = Math.ceil(milliseconds / (60 * 60 * 1_000));

    if (totalHours < 24) {
      return `${totalHours} ч`;
    }

    return `${Math.ceil(totalHours / 24)} дн.`;
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

  async function copySubscriptionUrl(): Promise<void> {
    if (subscription.status !== "active") {
      return;
    }

    try {
      await navigator.clipboard.writeText(subscription.subscriptionUrl);
      copyMessage = "Ссылка скопирована";
    } catch {
      copyMessage = "Не удалось скопировать ссылку";
    }
  }

  onMount(() => {
    try {
      promoInput = sessionStorage.getItem("astra_promo_code") ?? "";
    } catch {
      promoInput = "";
    }
    const timer = window.setInterval(() => {
      now = Date.now();
    }, 60_000);

    return () => window.clearInterval(timer);
  });

  $effect(() => {
    const promoCode =
      feedback?.action === "promo" && feedback.ok
        ? feedback.promoCode?.code
        : undefined;

    if (promoCode && typeof sessionStorage !== "undefined") {
      try {
        sessionStorage.setItem("astra_promo_code", promoCode);
        promoInput = promoCode;
      } catch {
        promoInput = promoCode;
      }
    }
  });
</script>

<header class="mb-5">
  <h1
    id="section-heading-profile"
    class="text-[30px] font-semibold tracking-[-0.03em]"
    tabindex="-1"
  >
    Профиль
  </h1>
</header>

<div class="mb-6 flex items-center gap-3.5">
  <div class="relative">
    <UserAvatar {user} size="large" />
    <span
      class="absolute right-0 bottom-0 h-4 w-4 rounded-full border-[3px] border-[color:var(--color-app)] bg-[color:var(--color-accent)]"
      aria-hidden="true"
    ></span>
  </div>
  <div class="min-w-0 flex-1">
    <h2 class="truncate text-[19px] font-semibold">{fullName}</h2>
    <p class="mt-0.5 truncate text-sm text-[color:var(--color-muted)]">
      {user.username ? `@${user.username}` : "Username не указан"}
    </p>
  </div>
  {#if isAdmin}
    <a
      class="grid min-h-11 min-w-11 place-items-center rounded-[15px] bg-[color:var(--color-card)] text-[color:var(--color-accent)]"
      href={resolve("/admin")}
      aria-label="Открыть административный раздел"
    >
      <AppIcon name="lock" size={21} />
    </a>
  {/if}
</div>

<p
  class="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-[color:var(--color-muted)] uppercase"
>
  Подписка
</p>
{#if subscription.status === "active"}
  <article class="surface mb-6 rounded-[25px] p-4">
    <div class="mb-2 flex items-center justify-between gap-3">
      <h3 class="truncate text-[20px] font-semibold">
        {subscription.planName}
      </h3>
      <span
        class="flex shrink-0 items-center gap-2 text-xs font-medium text-[color:var(--color-text)]"
      >
        <span
          class="h-2.5 w-2.5 rounded-full bg-[color:var(--color-accent)] shadow-[0_0_10px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]"
        ></span>
        Активна
      </span>
    </div>
    <p class="text-sm text-[color:var(--color-muted)]">
      Осталось {formatRemaining(remainingMilliseconds)} · до
      {formatDate(subscription.expiresAt)}
    </p>
    <div
      class="mt-3 mb-5 h-1.5 overflow-hidden rounded-full bg-[color:color-mix(in_srgb,var(--color-text)_7%,transparent)]"
      aria-label={`Осталось ${Math.round(subscriptionProgress)} процентов срока`}
    >
      <div
        class="h-full rounded-full bg-[color:var(--color-accent)]"
        style:width={`${subscriptionProgress}%`}
      ></div>
    </div>

    {#if subscription.qrCodeDataUrl}
      <img
        class="mx-auto h-[176px] w-[176px] rounded-[18px] bg-white p-2"
        src={subscription.qrCodeDataUrl}
        alt="QR-код ссылки подключения Astra VPN"
        width="176"
        height="176"
      />
      <p class="mt-3 mb-4 text-center text-xs text-[color:var(--color-muted)]">
        Отсканируйте QR-код в VPN-клиенте
      </p>
    {:else}
      <p
        class="mb-4 rounded-[15px] bg-[color:var(--color-card-raised)] px-3 py-3 text-center text-xs text-[color:var(--color-muted)]"
      >
        QR-код недоступен. Скопируйте ссылку подключения ниже.
      </p>
    {/if}

    <button
      class="flex min-h-12 w-full items-center gap-3 rounded-[15px] bg-[color:color-mix(in_srgb,var(--color-text)_4.5%,transparent)] px-3.5 py-3 text-left"
      type="button"
      onclick={copySubscriptionUrl}
    >
      <span
        class="min-w-0 flex-1 truncate text-xs text-[color:var(--color-muted)]"
      >
        {subscription.subscriptionUrl}
      </span>
      <AppIcon name="copy" size={20} />
    </button>
    {#if copyMessage}
      <p
        class="mt-2 text-center text-xs text-[color:var(--color-accent)]"
        role="status"
      >
        {copyMessage}
      </p>
    {/if}

    <div class="mt-2.5 grid grid-cols-2 gap-2.5">
      <button
        class="min-h-11 rounded-[15px] bg-[color:color-mix(in_srgb,var(--color-text)_5.5%,transparent)] px-3 py-3 text-sm font-semibold transition active:scale-[0.98]"
        type="button"
        onclick={() => onNavigate(1)}
      >
        Продлить
      </button>
      <details
        class="rounded-[15px] bg-[color:color-mix(in_srgb,var(--color-text)_5.5%,transparent)]"
      >
        <summary
          class="grid min-h-11 cursor-pointer place-items-center px-3 py-3 text-sm font-semibold"
        >
          Как настроить
        </summary>
        <p
          class="border-t border-[color:var(--color-border)] px-3 py-3 text-xs leading-5 text-[color:var(--color-muted)]"
        >
          Импортируйте ссылку или QR-код в приложение с поддержкой VLESS, затем
          выберите созданный профиль.
        </p>
      </details>
    </div>
  </article>
{:else if subscription.status === "provisioning" || subscription.status === "provisioning_failed"}
  <article class="surface mb-6 rounded-[25px] p-5">
    <span
      class="grid h-12 w-12 place-items-center rounded-[16px] bg-[color:color-mix(in_srgb,var(--color-accent)_11%,transparent)] text-[color:var(--color-accent)]"
    >
      <AppIcon name="shield" size={25} />
    </span>
    <h3 class="mt-4 text-[19px] font-semibold">
      Оплата получена, доступ создаётся
    </h3>
    <p class="mt-1 text-sm leading-6 text-[color:var(--color-muted)]">
      {subscription.status === "provisioning_failed"
        ? "Marzban временно недоступен. Повтор будет выполнен автоматически — оплачивать ещё раз не нужно."
        : "Сервер подтверждает подписку. QR-код появится здесь автоматически."}
    </p>
  </article>
{:else if subscription.status === "error"}
  <article class="surface mb-6 rounded-[25px] p-5">
    <span
      class="grid h-12 w-12 place-items-center rounded-[16px] bg-red-500/10 text-red-400"
    >
      <AppIcon name="shield" size={25} />
    </span>
    <h3 class="mt-4 text-[19px] font-semibold">
      Не удалось загрузить подписку
    </h3>
    <p class="mt-1 text-sm leading-6 text-[color:var(--color-muted)]">
      Доступ не изменён. Обратитесь в поддержку, чтобы восстановить ссылку
      подключения.
    </p>
    <button
      class="mt-4 min-h-11 w-full rounded-[15px] bg-[color:var(--color-text)] px-4 py-3 text-sm font-semibold text-[color:var(--color-app)]"
      type="button"
      onclick={() => onNavigate(0)}
    >
      Открыть поддержку
    </button>
  </article>
{:else}
  <article class="surface mb-6 rounded-[25px] p-5">
    <span
      class="grid h-12 w-12 place-items-center rounded-[16px] bg-[color:color-mix(in_srgb,var(--color-accent)_11%,transparent)] text-[color:var(--color-accent)]"
    >
      <AppIcon name="shield" size={25} />
    </span>
    <h3 class="mt-4 text-[19px] font-semibold">Активной подписки нет</h3>
    <p class="mt-1 text-sm leading-6 text-[color:var(--color-muted)]">
      Подписка, QR-код и ссылка подключения появятся после подтверждённой
      оплаты.
    </p>
    <button
      class="mt-4 min-h-11 w-full rounded-[15px] bg-[color:var(--color-accent)] px-4 py-3 text-sm font-semibold text-[color:var(--color-button-text)]"
      type="button"
      onclick={() => onNavigate(1)}
    >
      Выбрать тариф
    </button>
  </article>
{/if}

<h2
  class="mb-2.5 text-[11px] font-semibold tracking-[0.12em] text-[color:var(--color-muted)] uppercase"
>
  Промокод
</h2>
<form
  method="POST"
  action="?/applyPromo"
  class="mb-3 flex gap-2"
  use:enhance={enhancePromo}
>
  <label class="sr-only" for="promo-code">Промокод</label>
  <input
    id="promo-code"
    name="code"
    bind:value={promoInput}
    required
    minlength="3"
    maxlength="32"
    autocomplete="off"
    placeholder="Введите код"
    class="form-control min-w-0 flex-1 uppercase"
    disabled={submittingPromo}
  />
  <button
    class="min-h-11 rounded-[15px] bg-[color:var(--color-text)] px-4 py-3 text-sm font-semibold text-[color:var(--color-app)] disabled:cursor-wait disabled:opacity-60"
    type="submit"
    disabled={submittingPromo}
  >
    {submittingPromo ? "Проверяем…" : "Применить"}
  </button>
</form>

{#if feedback?.action === "promo"}
  <div
    class:feedback-error={!feedback.ok}
    class:feedback-success={feedback.ok}
    class="mb-6 rounded-[16px] px-4 py-3 text-sm"
    role={feedback.ok ? "status" : "alert"}
  >
    {feedback.message}
  </div>
{:else}
  <p class="mb-6 text-xs leading-5 text-[color:var(--color-muted)]">
    Код проверяется сервером и не резервирует скидку до оплаты.
  </p>
{/if}

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
      Здесь появятся сумма, скидка, статус оплаты и выдачи доступа.
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

<form method="POST" action="?/logout" use:enhance>
  <button
    class="min-h-11 w-full rounded-[16px] border border-[color:var(--color-border)] bg-[color:var(--color-card)] px-4 py-3 text-sm font-semibold transition active:scale-[0.985]"
    type="submit"
  >
    Выйти из аккаунта
  </button>
</form>

<p class="mt-4 text-center text-xs text-[color:var(--color-muted)]">
  Telegram ID: {user.telegramUserId}
</p>
