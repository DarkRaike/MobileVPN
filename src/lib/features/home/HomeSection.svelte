<script lang="ts">
  import { enhance } from "$app/forms";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { onMount } from "svelte";
  import { SvelteMap } from "svelte/reactivity";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import type {
    AppActionFeedback,
    CatalogPlan,
  } from "$lib/features/catalog/types";
  import type { AuthenticatedUser } from "$lib/server/auth/sessions";
  import type { getProfileOverview } from "$lib/server/modules/subscriptions/profile";
  import {
    getTelegramWebApp,
    isTelegramVersionAtLeast,
  } from "$lib/telegram/web-app";

  let {
    feedback,
    plans,
    profileOverview,
    purchaseRequest,
    purchasesEnabled,
    user,
  }: {
    feedback: AppActionFeedback | null;
    plans: CatalogPlan[];
    profileOverview: Awaited<ReturnType<typeof getProfileOverview>>;
    purchaseRequest: number;
    purchasesEnabled: boolean;
    user: AuthenticatedUser | null;
  } = $props();

  let purchaseMessage = $state<string | null>(null);
  let promoInput = $state("");
  let sheetMessage = $state<string | null>(null);
  let submittingPlanId = $state<string | null>(null);
  let submittingPromo = $state(false);
  let termsAccepted = $state(false);
  let handledPurchaseRequest = 0;
  const purchaseAttemptKeys = new SvelteMap<string, string>();
  const subscription = $derived(profileOverview.subscription);
  const isAuthenticated = $derived(user !== null);
  const welcomeName = $derived(
    user?.username
      ? `@${user.username}`
      : user
        ? "Username не указан"
        : "Инкогнито",
  );
  const promoPreviewByPlan = $derived(
    new Map(
      feedback?.action === "promo" && feedback.ok
        ? (feedback.promoCode?.preview ?? []).map((preview) => [
            preview.planId,
            preview,
          ])
        : [],
    ),
  );

  function formatDate(value: Date): string {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
      year: "numeric",
    }).format(value);
  }

  function formatTrafficUsage(bytes: number | null): string {
    if (bytes === null) {
      return "Нет данных";
    }

    return `${new Intl.NumberFormat("ru-RU", {
      maximumFractionDigits: 1,
    }).format(bytes / 1024 ** 3)} ГБ`;
  }

  function getStoredPromoCode(): string {
    try {
      return sessionStorage.getItem("astra_promo_code") ?? "";
    } catch {
      return "";
    }
  }

  function openPurchaseSheet(message: string | null = null): void {
    sheetMessage = message;
    showDialog("plans-dialog");
  }

  function closePurchaseSheet(): void {
    closeDialog("plans-dialog");
    sheetMessage = null;
  }

  function openPromoSheet(): void {
    showDialog("promo-dialog");
  }

  function closePromoSheet(): void {
    closeDialog("promo-dialog");
  }

  function handlePurchaseDialogClose(): void {
    sheetMessage = null;
  }

  function getDialog(id: string): HTMLDialogElement | null {
    const dialog = document.getElementById(id);

    return dialog instanceof HTMLDialogElement ? dialog : null;
  }

  function showDialog(id: string): void {
    const dialog = getDialog(id);

    if (dialog && !dialog.open) {
      dialog.showModal();
    }
  }

  function closeDialog(id: string): void {
    const dialog = getDialog(id);

    if (dialog?.open) {
      dialog.close();
    }
  }

  function openSetup(): void {
    if (subscription.status === "active") {
      void goto(resolve("/setup"));
      return;
    }

    openPurchaseSheet("Для настройки сначала выберите подходящий тариф.");
  }

  function enhancePurchase(planId: string): SubmitFunction {
    return ({ cancel, formData }) => {
      if (!isAuthenticated) {
        cancel();
        purchaseMessage = "Покупка доступна после входа через Telegram.";
        return;
      }

      if (!termsAccepted || submittingPlanId) {
        cancel();
        return;
      }

      const webApp = getTelegramWebApp();
      const openInvoice = webApp?.openInvoice?.bind(webApp);

      if (!webApp || !openInvoice) {
        cancel();
        purchaseMessage =
          "Откройте приложение внутри Telegram, чтобы оплатить счёт.";
        return;
      }

      if (!isTelegramVersionAtLeast(webApp.version, "6.1")) {
        cancel();
        purchaseMessage =
          "Обновите Telegram до актуальной версии, чтобы оплатить счёт.";
        return;
      }

      const attemptKey = purchaseAttemptKeys.get(planId) ?? crypto.randomUUID();
      purchaseAttemptKeys.set(planId, attemptKey);
      formData.set("idempotencyKey", attemptKey);
      formData.set("promoCode", getStoredPromoCode());
      submittingPlanId = planId;
      purchaseMessage = null;

      return async ({ result, update }) => {
        await update({ invalidateAll: false, reset: false });
        submittingPlanId = null;

        if (
          result.type !== "success" ||
          typeof result.data?.invoiceUrl !== "string"
        ) {
          return;
        }

        purchaseAttemptKeys.delete(planId);
        openInvoice(result.data.invoiceUrl, (status) => {
          purchaseMessage =
            status === "paid"
              ? "Telegram принял оплату. Ожидаем серверное подтверждение."
              : status === "pending"
                ? "Платёж обрабатывается. Статус появится в профиле."
                : status === "cancelled"
                  ? "Оплата отменена."
                  : "Telegram не смог завершить оплату.";
          closePurchaseSheet();
        });
      };
    };
  }

  const enhancePromo: SubmitFunction = () => {
    submittingPromo = true;

    return async ({ update }) => {
      await update({ reset: false });
      submittingPromo = false;
    };
  };

  onMount(() => {
    promoInput = getStoredPromoCode();
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

  $effect(() => {
    if (purchaseRequest > handledPurchaseRequest) {
      handledPurchaseRequest = purchaseRequest;
      openPurchaseSheet();
    }
  });
</script>

<header class="mb-6">
  <p class="text-sm text-[color:var(--color-muted)]">Добро пожаловать</p>
  <h1
    id="section-heading-home"
    class="mt-1 truncate text-[30px] font-semibold tracking-[-0.03em]"
    tabindex="-1"
  >
    {welcomeName}
  </h1>
</header>

<section aria-labelledby="benefits-heading" class="mb-6">
  <h2 id="benefits-heading" class="sr-only">Преимущества сервиса</h2>
  <div class="grid grid-cols-2 gap-2.5">
    <article class="feature-card">
      <div class="feature-card-heading">
        <span class="feature-icon"><AppIcon name="lock" size={19} /></span>
        <h3>Без логов</h3>
      </div>
      <p>Личные данные не храним</p>
    </article>
    <article class="feature-card">
      <div class="feature-card-heading">
        <span class="feature-icon"><AppIcon name="shield" size={19} /></span>
        <h3>VLESS / Xray</h3>
      </div>
      <p>Современный протокол</p>
    </article>
    <article class="feature-card">
      <div class="feature-card-heading">
        <span class="feature-icon"><AppIcon name="headset" size={19} /></span>
        <h3>Поддержка 24/7</h3>
      </div>
      <p>Поможем с настройкой</p>
    </article>
    <article class="feature-card">
      <div class="feature-card-heading">
        <span class="feature-icon"><AppIcon name="devices" size={19} /></span>
        <h3>До 3 устройств</h3>
      </div>
      <p>Для личного пользования</p>
    </article>
  </div>
</section>

<section aria-labelledby="current-plan-heading">
  <div class="mb-2.5 flex items-center justify-between">
    <h2
      id="current-plan-heading"
      class="text-[11px] font-semibold tracking-[0.12em] text-[color:var(--color-muted)] uppercase"
    >
      Текущий план
    </h2>
    {#if subscription.status === "active"}
      <span class="status-pill status-active">Активен</span>
    {:else if subscription.status === "provisioning" || subscription.status === "provisioning_failed"}
      <span class="status-pill">Создаётся</span>
    {:else}
      <span class="status-pill">Отсутствует</span>
    {/if}
  </div>

  <article class="current-plan surface mb-4 rounded-[26px] p-4" data-no-swipe>
    {#if subscription.status === "active"}
      <h3 class="truncate text-[22px] font-semibold">
        {subscription.planName}
      </h3>
      <dl class="plan-details">
        <div>
          <dt>Действует до</dt>
          <dd>{formatDate(subscription.expiresAt)}</dd>
        </div>
        <div>
          <dt>Использовано</dt>
          <dd>{formatTrafficUsage(subscription.usedTrafficBytes)}</dd>
        </div>
      </dl>
    {:else if subscription.status === "provisioning" || subscription.status === "provisioning_failed"}
      <h3 class="truncate text-[22px] font-semibold">
        {subscription.planName}
      </h3>
      <p class="mt-1 text-sm leading-6 text-[color:var(--color-muted)]">
        Оплата получена. Доступ появится после завершения настройки сервера.
      </p>
    {:else}
      <h3 class="text-[22px] font-semibold">Подписки нет</h3>
      <p class="mt-1 text-sm leading-6 text-[color:var(--color-muted)]">
        Выберите тариф, чтобы получить доступ к защищённому соединению.
      </p>
    {/if}

    <div class="mt-5 grid grid-cols-3 gap-2">
      <button
        class="plan-action plan-action-primary"
        type="button"
        onclick={() => openPurchaseSheet()}
      >
        Купить
      </button>
      <button class="plan-action" type="button" onclick={openSetup}>
        Настроить
      </button>
      <button class="plan-action" type="button" onclick={openPromoSheet}>
        Промокод
      </button>
    </div>
  </article>

  {#if feedback?.action === "purchase" || purchaseMessage}
    <div
      class:feedback-error={feedback?.action === "purchase" && !feedback.ok}
      class:feedback-success={feedback?.action !== "purchase" || feedback.ok}
      class="mb-4 rounded-[16px] px-4 py-3 text-sm"
      role={feedback?.action === "purchase" && !feedback.ok
        ? "alert"
        : "status"}
    >
      {purchaseMessage ?? feedback?.message}
    </div>
  {/if}
</section>

<dialog
  id="plans-dialog"
  class="bottom-sheet"
  aria-labelledby="plans-sheet-heading"
  onclose={handlePurchaseDialogClose}
>
  <div class="bottom-sheet-handle" aria-hidden="true"></div>
  <div class="mb-4 flex items-start justify-between gap-3">
    <div>
      <h2 id="plans-sheet-heading" class="text-[22px] font-semibold">Тарифы</h2>
      <p class="mt-1 text-sm text-[color:var(--color-muted)]">
        Выберите срок доступа
      </p>
    </div>
    <button
      class="sheet-close"
      type="button"
      aria-label="Закрыть выбор тарифа"
      onclick={closePurchaseSheet}
    >
      ×
    </button>
  </div>

  {#if sheetMessage}
    <p
      class="mb-3 rounded-[14px] bg-[color:color-mix(in_srgb,var(--color-accent)_11%,transparent)] px-3 py-2.5 text-sm text-[color:var(--color-accent)]"
    >
      {sheetMessage}
    </p>
  {/if}

  {#if !isAuthenticated}
    <p
      class="mb-3 rounded-[14px] bg-[color:var(--color-card-raised)] px-3 py-2.5 text-sm leading-5 text-[color:var(--color-muted)]"
    >
      Для покупки откройте приложение из Telegram.
    </p>
  {/if}

  {#if !purchasesEnabled}
    <p class="mb-3 text-xs leading-5 text-[color:var(--color-muted)]">
      Реальные платежи отключены до прохождения production gates.
    </p>
  {/if}

  <label class="terms-control mb-3">
    <input
      type="checkbox"
      bind:checked={termsAccepted}
      disabled={!purchasesEnabled || !isAuthenticated}
    />
    <span>Подтверждаю условия покупки и разовый платёж в Telegram Stars.</span>
  </label>

  {#if plans.length === 0}
    <article class="surface rounded-[20px] p-4">
      <p class="font-semibold">Нет доступных тарифов</p>
      <p class="mt-1 text-sm text-[color:var(--color-muted)]">
        Попробуйте обновить приложение позже.
      </p>
    </article>
  {:else}
    <div class="space-y-2.5">
      {#each plans as plan (plan.id)}
        {@const preview = promoPreviewByPlan.get(plan.id)}
        <article class:featured={plan.isFeatured} class="tariff tariff-compact">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <h3 class="truncate text-[17px] font-semibold">
                {plan.name}
              </h3>
              {#if plan.isFeatured}
                <span class="featured-mark">Рекомендуем</span>
              {/if}
            </div>
            <p class="mt-0.5 truncate text-xs text-[color:var(--color-muted)]">
              {plan.durationDays} дней · {plan.description ??
                "Безлимитный трафик"}
            </p>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-right whitespace-nowrap">
              {#if preview}
                <span
                  class="block text-[11px] text-[color:var(--color-muted)] line-through"
                >
                  {plan.priceStars} ⭐
                </span>
                <span class="block text-[17px] font-semibold"
                  >{preview.totalStars} ⭐</span
                >
              {:else}
                <span class="block text-[17px] font-semibold"
                  >{plan.priceStars} ⭐</span
                >
              {/if}
            </span>
            <form
              method="POST"
              action="?/createOrder"
              use:enhance={enhancePurchase(plan.id)}
            >
              <input type="hidden" name="planId" value={plan.id} />
              <input type="hidden" name="promoCode" value="" />
              <input type="hidden" name="idempotencyKey" value="" />
              <input
                type="hidden"
                name="termsAccepted"
                value={termsAccepted ? "true" : "false"}
              />
              <button
                class="buy-button"
                type="submit"
                disabled={!purchasesEnabled ||
                  !termsAccepted ||
                  submittingPlanId !== null}
              >
                {submittingPlanId === plan.id ? "Счёт…" : "Купить"}
              </button>
            </form>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</dialog>

<dialog
  id="promo-dialog"
  class="bottom-sheet bottom-sheet-small"
  aria-labelledby="promo-sheet-heading"
>
  <div class="bottom-sheet-handle" aria-hidden="true"></div>
  <div class="mb-4 flex items-start justify-between gap-3">
    <div>
      <h2 id="promo-sheet-heading" class="text-[22px] font-semibold">
        Промокод
      </h2>
      <p class="mt-1 text-sm text-[color:var(--color-muted)]">
        Скидка будет повторно проверена при оплате.
      </p>
    </div>
    <button
      class="sheet-close"
      type="button"
      aria-label="Закрыть промокод"
      onclick={closePromoSheet}
    >
      ×
    </button>
  </div>

  {#if isAuthenticated}
    <form
      method="POST"
      action="?/applyPromo"
      class="flex gap-2"
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
        class="buy-button min-w-[104px]"
        type="submit"
        disabled={submittingPromo}
      >
        {submittingPromo ? "Проверяем…" : "Применить"}
      </button>
    </form>
  {:else}
    <p
      class="rounded-[14px] bg-[color:var(--color-card-raised)] px-3 py-3 text-sm leading-5 text-[color:var(--color-muted)]"
    >
      Войти и применить промокод можно только внутри Telegram.
    </p>
  {/if}

  {#if feedback?.action === "promo"}
    <div
      class:feedback-error={!feedback.ok}
      class:feedback-success={feedback.ok}
      class="mt-3 rounded-[16px] px-4 py-3 text-sm"
      role={feedback.ok ? "status" : "alert"}
    >
      {feedback.message}
    </div>
  {/if}
</dialog>
