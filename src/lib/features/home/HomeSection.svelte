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

  const DAY_MS = 86_400_000;
  const PROMO_CODE_KEY = "astra_promo_code";
  const PROMO_LABEL_KEY = "astra_promo_label";

  let {
    feedback,
    onOpenProfile,
    plans,
    profileOverview,
    purchaseRequest,
    purchasesEnabled,
    user,
  }: {
    feedback: AppActionFeedback | null;
    onOpenProfile: () => void;
    plans: CatalogPlan[];
    profileOverview: Awaited<ReturnType<typeof getProfileOverview>>;
    purchaseRequest: number;
    purchasesEnabled: boolean;
    user: AuthenticatedUser | null;
  } = $props();

  let promoInput = $state("");
  let storedPromoCode = $state("");
  let storedPromoLabel = $state("");
  let submittingPlanId = $state<string | null>(null);
  let submittingPromo = $state(false);
  let termsAccepted = $state(false);
  let toastMessage = $state<string | null>(null);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let handledPurchaseRequest = 0;
  const purchaseAttemptKeys = new SvelteMap<string, string>();

  const subscription = $derived(profileOverview.subscription);
  const isAuthenticated = $derived(user !== null);
  const welcomeName = $derived(
    user
      ? user.username
        ? `@${user.username}`
        : user.firstName || "Без username"
      : "Инкогнито",
  );
  const avatarInitial = $derived(
    user?.firstName
      ? user.firstName.trim().charAt(0).toLocaleUpperCase("ru")
      : "",
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
  const promoChipText = $derived(
    storedPromoCode
      ? `Промокод ${storedPromoCode}${storedPromoLabel ? ` · ${storedPromoLabel}` : ""}`
      : "",
  );
  const subscriptionDays = $derived(
    subscription.status === "active"
      ? Math.max(
          1,
          Math.round(
            (subscription.expiresAt.getTime() -
              subscription.startsAt.getTime()) /
              DAY_MS,
          ),
        )
      : 0,
  );
  const daysLeft = $derived(
    subscription.status === "active"
      ? Math.max(
          0,
          Math.ceil((subscription.expiresAt.getTime() - Date.now()) / DAY_MS),
        )
      : 0,
  );
  const progressPercent = $derived(
    subscriptionDays > 0
      ? Math.max(
          4,
          Math.min(100, Math.round((daysLeft / subscriptionDays) * 100)),
        )
      : 0,
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

  function showToast(message: string, durationMs = 5_000): void {
    toastMessage = message;

    if (toastTimer) {
      clearTimeout(toastTimer);
    }

    toastTimer = setTimeout(() => {
      toastMessage = null;
      toastTimer = null;
    }, durationMs);
  }

  function readSessionValue(key: string): string {
    try {
      return sessionStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  }

  function writeSessionValue(key: string, value: string): void {
    try {
      if (value) {
        sessionStorage.setItem(key, value);
      } else {
        sessionStorage.removeItem(key);
      }
    } catch {
      // Session storage can be unavailable inside privacy modes.
    }
  }

  function removePromo(): void {
    storedPromoCode = "";
    storedPromoLabel = "";
    promoInput = "";
    writeSessionValue(PROMO_CODE_KEY, "");
    writeSessionValue(PROMO_LABEL_KEY, "");
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

  function openPurchaseSheet(): void {
    closeDialog("hint-dialog");
    closeDialog("promo-dialog");
    showDialog("plans-dialog");
  }

  function closePurchaseSheet(): void {
    closeDialog("plans-dialog");
  }

  function openPromoSheet(): void {
    showDialog("promo-dialog");
  }

  function closePromoSheet(): void {
    closeDialog("promo-dialog");
  }

  function openSetup(): void {
    if (subscription.status === "active") {
      void goto(resolve("/setup"));
      return;
    }

    showDialog("hint-dialog");
  }

  function enhancePurchase(planId: string): SubmitFunction {
    return ({ cancel, formData }) => {
      if (!isAuthenticated) {
        cancel();
        showToast("Покупка доступна после входа через Telegram.");
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
        showToast("Откройте приложение внутри Telegram, чтобы оплатить счёт.");
        return;
      }

      if (!isTelegramVersionAtLeast(webApp.version, "6.1")) {
        cancel();
        showToast(
          "Обновите Telegram до актуальной версии, чтобы оплатить счёт.",
        );
        return;
      }

      const attemptKey = purchaseAttemptKeys.get(planId) ?? crypto.randomUUID();
      purchaseAttemptKeys.set(planId, attemptKey);
      formData.set("idempotencyKey", attemptKey);
      formData.set("promoCode", storedPromoCode);
      submittingPlanId = planId;

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
          showToast(
            status === "paid"
              ? "Telegram принял оплату. Ожидаем серверное подтверждение."
              : status === "pending"
                ? "Платёж обрабатывается. Статус появится в профиле."
                : status === "cancelled"
                  ? "Оплата отменена."
                  : "Telegram не смог завершить оплату.",
            6_000,
          );
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
    storedPromoCode = readSessionValue(PROMO_CODE_KEY);
    storedPromoLabel = readSessionValue(PROMO_LABEL_KEY);
    promoInput = storedPromoCode;

    return () => {
      if (toastTimer) {
        clearTimeout(toastTimer);
      }
    };
  });

  $effect(() => {
    const promoCode =
      feedback?.action === "promo" && feedback.ok
        ? feedback.promoCode
        : undefined;

    if (promoCode) {
      const label =
        promoCode.discountType === "percent"
          ? `−${promoCode.discountValue}%`
          : `−${promoCode.discountValue} ⭐`;

      storedPromoCode = promoCode.code;
      storedPromoLabel = label;
      promoInput = promoCode.code;
      writeSessionValue(PROMO_CODE_KEY, promoCode.code);
      writeSessionValue(PROMO_LABEL_KEY, label);
    }
  });

  $effect(() => {
    if (purchaseRequest > handledPurchaseRequest) {
      handledPurchaseRequest = purchaseRequest;
      openPurchaseSheet();
    }
  });
</script>

<header class="mb-5 flex items-center justify-between gap-3.5">
  <div class="min-w-0">
    <p class="m-0 text-[13px] text-[color:var(--muted)]">Добро пожаловать</p>
    <h1 id="section-heading-home" class="lg-h1 mt-1 truncate" tabindex="-1">
      {welcomeName}
    </h1>
  </div>
  <button
    class="avatar-button"
    type="button"
    aria-label="Открыть профиль"
    onclick={onOpenProfile}
  >
    {#if user?.photoUrl}
      <img
        class="h-full w-full object-cover"
        src={user.photoUrl}
        alt=""
        referrerpolicy="no-referrer"
      />
    {:else if avatarInitial}
      <span class="avatar-initial">{avatarInitial}</span>
    {:else}
      <AppIcon name="profile" size={22} />
    {/if}
  </button>
</header>

<section aria-labelledby="benefits-heading" class="mb-5">
  <h2 id="benefits-heading" class="sr-only">Преимущества сервиса</h2>
  <div class="feature-grid">
    <div class="feature-cell">
      <span class="lg-icon-badge"><AppIcon name="lock" size={16} /></span>
      <span>Без логов</span>
    </div>
    <div class="feature-cell">
      <span class="lg-icon-badge"><AppIcon name="shield" size={16} /></span>
      <span>XRAY · VLESS</span>
    </div>
    <div class="feature-cell">
      <span class="lg-icon-badge"><AppIcon name="headset" size={16} /></span>
      <span>Поддержка 24/7</span>
    </div>
    <div class="feature-cell">
      <span class="lg-icon-badge"><AppIcon name="devices" size={16} /></span>
      <span>До 3 устройств</span>
    </div>
  </div>
</section>

<section aria-labelledby="current-plan-heading">
  <div class="mb-2.5 flex items-center justify-between gap-2.5 px-0.5">
    <h2 id="current-plan-heading" class="lg-eyebrow">Текущий план</h2>
    {#if subscription.status === "active"}
      <span class="status-pill status-active">Активен</span>
    {:else if subscription.status === "provisioning" || subscription.status === "provisioning_failed"}
      <span class="status-pill">Создаётся</span>
    {:else}
      <span class="status-pill">Отсутствует</span>
    {/if}
  </div>

  <article class="surface p-[18px]" data-no-swipe>
    {#if subscription.status === "active"}
      <div class="flex items-baseline justify-between gap-2.5">
        <h3 class="m-0 truncate text-[23px] font-medium tracking-[-0.02em]">
          {subscription.planName}
        </h3>
        <span class="shrink-0 text-xs text-[color:var(--muted)]">
          {subscriptionDays} дней
        </span>
      </div>
      <dl class="plan-facts">
        <div>
          <dt>Действует до</dt>
          <dd>{formatDate(subscription.expiresAt)}</dd>
        </div>
        <div>
          <dt>Использовано</dt>
          <dd>{formatTrafficUsage(subscription.usedTrafficBytes)}</dd>
        </div>
      </dl>
      <div class="mt-3.5">
        <div class="mb-[7px] flex items-center justify-between gap-2">
          <span class="text-[11.5px] text-[color:var(--muted)]">
            Осталось {daysLeft} дн.
          </span>
          <span class="text-[11.5px] text-[color:var(--faint)]">
            Безлимитный трафик
          </span>
        </div>
        <div class="plan-progress-track">
          <span class="plan-progress-fill" style:width={`${progressPercent}%`}
          ></span>
        </div>
      </div>
    {:else if subscription.status === "provisioning" || subscription.status === "provisioning_failed"}
      <h3 class="m-0 truncate text-[23px] font-medium tracking-[-0.02em]">
        {subscription.planName}
      </h3>
      <p
        class="mt-[7px] mb-0 text-[13.5px] leading-normal text-[color:var(--muted)]"
      >
        Оплата получена. Доступ создаётся — QR-код появится автоматически.
      </p>
    {:else}
      <h3 class="m-0 text-[23px] font-medium tracking-[-0.02em]">
        Подписки нет
      </h3>
      <p
        class="mt-[7px] mb-0 text-[13.5px] leading-normal text-[color:var(--muted)]"
      >
        Выберите тариф, чтобы получить защищённое соединение и ссылку
        подключения.
      </p>
    {/if}

    <button
      class="lg-btn-primary mt-[18px] w-full"
      type="button"
      onclick={openPurchaseSheet}
    >
      {subscription.status === "active" ? "Продлить подписку" : "Купить"}
    </button>

    <div class="mt-[9px] grid grid-cols-2 gap-[9px]">
      <button
        class="lg-btn-glass px-2.5 text-[12.5px]"
        type="button"
        onclick={openSetup}
      >
        <AppIcon name="download" size={17} />
        Установить
      </button>
      <button
        class="lg-btn-glass px-2.5 text-[12.5px]"
        type="button"
        onclick={openPromoSheet}
      >
        <AppIcon name="spark" size={17} />
        Промокоды
      </button>
    </div>

    {#if storedPromoCode}
      <div class="lg-success-chip mt-3" data-no-swipe>
        <AppIcon name="check" size={16} />
        <span class="flex-1">{promoChipText}</span>
        <button
          class="border-0 bg-transparent p-0 text-[11.5px] text-[color:var(--accent-deep)] underline"
          type="button"
          onclick={removePromo}
        >
          Убрать
        </button>
      </div>
    {/if}
  </article>
</section>

{#if toastMessage}
  <div class="glass-toast" role="status">{toastMessage}</div>
{/if}

<dialog
  id="plans-dialog"
  class="bottom-sheet"
  aria-labelledby="plans-sheet-heading"
>
  <div class="bottom-sheet-handle" aria-hidden="true"></div>
  <div class="mb-3.5 flex items-start justify-between gap-3">
    <div>
      <h2
        id="plans-sheet-heading"
        class="m-0 text-[21px] font-medium tracking-[-0.02em]"
      >
        Тарифы
      </h2>
      <p class="mt-1 mb-0 text-[12.5px] text-[color:var(--muted)]">
        Оплата разовая, Telegram Stars
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

  {#if storedPromoCode}
    <div class="lg-success-chip mb-3">
      <AppIcon name="check" size={15} />
      <span>{promoChipText}</span>
    </div>
  {/if}

  {#if !isAuthenticated}
    <p class="lg-error mb-3">Для покупки откройте приложение из Telegram.</p>
  {:else if !purchasesEnabled}
    <p class="mb-3 text-[11.5px] leading-snug text-[color:var(--faint)]">
      Реальные платежи отключены до прохождения production gates.
    </p>
  {/if}

  {#if feedback?.action === "purchase" && !feedback.ok}
    <p class="lg-error mb-3" role="alert">{feedback.message}</p>
  {/if}

  {#if plans.length === 0}
    <article class="tariff">
      <div class="min-w-0 flex-1">
        <h3 class="m-0 text-[15.5px] font-medium">Нет доступных тарифов</h3>
        <p class="mt-1 mb-0 text-[11.5px] text-[color:var(--muted)]">
          Попробуйте обновить приложение позже.
        </p>
      </div>
    </article>
  {:else}
    <div class="flex flex-col gap-2">
      {#each plans as plan (plan.id)}
        {@const preview = promoPreviewByPlan.get(plan.id)}
        <article class:featured={plan.isFeatured} class="tariff">
          <div class="flex items-start justify-between gap-2.5">
            <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <h3 class="m-0 text-[15.5px] font-medium">
                {plan.name}
              </h3>
              {#if plan.isFeatured}
                <span class="featured-mark">Выгодно</span>
              {/if}
            </div>
            <div class="shrink-0 text-right">
              {#if preview}
                <p
                  class="m-0 text-[10.5px] text-[color:var(--faint)] line-through"
                >
                  {plan.priceStars} ⭐
                </p>
                <p class="m-0 text-[15px] font-semibold whitespace-nowrap">
                  {preview.totalStars} ⭐
                </p>
              {:else}
                <p class="m-0 text-[15px] font-semibold whitespace-nowrap">
                  {plan.priceStars} ⭐
                </p>
              {/if}
            </div>
          </div>
          <p class="mt-1 mb-0 text-[11.5px] text-[color:var(--muted)]">
            {plan.durationDays} дней · {plan.description ??
              "безлимит · до 3 устройств"}
          </p>
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
              class="lg-btn-accent buy-button mt-2.5 w-full"
              type="submit"
              disabled={!purchasesEnabled ||
                !termsAccepted ||
                submittingPlanId !== null}
            >
              {submittingPlanId === plan.id ? "Счёт…" : "Купить"}
            </button>
          </form>
        </article>
      {/each}
    </div>
  {/if}

  <label class="terms-control mt-3">
    <input
      type="checkbox"
      bind:checked={termsAccepted}
      disabled={!purchasesEnabled || !isAuthenticated}
    />
    <span>Подтверждаю условия покупки и разовый платёж в Telegram Stars</span>
  </label>
</dialog>

<dialog
  id="promo-dialog"
  class="bottom-sheet"
  aria-labelledby="promo-sheet-heading"
>
  <div class="bottom-sheet-handle" aria-hidden="true"></div>
  <div class="mb-3.5 flex items-start justify-between gap-3">
    <div>
      <h2
        id="promo-sheet-heading"
        class="m-0 text-[21px] font-medium tracking-[-0.02em]"
      >
        Промокоды
      </h2>
      <p class="mt-1 mb-0 text-[12.5px] text-[color:var(--muted)]">
        Скидка проверяется повторно при оплате
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

  {#if !isAuthenticated}
    <p class="lg-error">
      Войти и применить промокод можно только внутри Telegram.
    </p>
  {:else if storedPromoCode}
    <div
      class="flex items-center gap-3 rounded-[20px] bg-[color:color-mix(in_srgb,var(--accent)_20%,transparent)] p-3.5"
    >
      <span
        class="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-[color:var(--accent)] text-white"
      >
        <AppIcon name="check" size={18} />
      </span>
      <div class="min-w-0 flex-1">
        <p class="m-0 text-[15px] font-semibold tracking-[0.04em]">
          {storedPromoCode}
        </p>
        <p class="mt-[3px] mb-0 text-xs text-[color:var(--muted)]">
          {storedPromoLabel
            ? `Скидка ${storedPromoLabel} на выбранный тариф`
            : "Скидка проверяется при оплате"}
        </p>
      </div>
    </div>
    <div class="mt-3 grid grid-cols-2 gap-[9px]">
      <button class="lg-btn-accent" type="button" onclick={openPurchaseSheet}>
        К тарифам
      </button>
      <button class="lg-btn-glass" type="button" onclick={removePromo}>
        Убрать код
      </button>
    </div>
  {:else}
    <form
      method="POST"
      action="?/applyPromo"
      class="flex gap-[9px]"
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
        class="form-control min-h-[50px] min-w-0 flex-1 tracking-[0.06em] uppercase"
        disabled={submittingPromo}
      />
      <button
        class="lg-btn-accent min-h-[50px] min-w-[112px] shrink-0"
        type="submit"
        disabled={submittingPromo}
      >
        {submittingPromo ? "Проверяем…" : "Применить"}
      </button>
    </form>
    <p class="mt-3 mb-0 text-[11.5px] leading-snug text-[color:var(--faint)]">
      Код применяется к выбранному тарифу и не резервирует скидку заранее.
    </p>
  {/if}

  {#if feedback?.action === "promo"}
    <div
      class:feedback-error={!feedback.ok}
      class:feedback-success={feedback.ok}
      class="mt-3 px-3 py-2.5 text-[12.5px]"
      role={feedback.ok ? "status" : "alert"}
    >
      {feedback.message}
    </div>
  {/if}
</dialog>

<dialog
  id="hint-dialog"
  class="bottom-sheet"
  aria-labelledby="hint-sheet-heading"
>
  <div class="bottom-sheet-handle" aria-hidden="true"></div>
  <div class="mb-3.5 flex items-start justify-between gap-3">
    <div>
      <h2
        id="hint-sheet-heading"
        class="m-0 text-[21px] font-medium tracking-[-0.02em]"
      >
        Сначала выберите тариф
      </h2>
      <p
        class="mt-1 mb-0 text-[12.5px] leading-normal text-[color:var(--muted)]"
      >
        QR-код и ссылка подключения появятся сразу после подтверждённой оплаты.
      </p>
    </div>
    <button
      class="sheet-close"
      type="button"
      aria-label="Закрыть подсказку"
      onclick={() => closeDialog("hint-dialog")}
    >
      ×
    </button>
  </div>
  <button
    class="lg-btn-primary w-full text-[14.5px]"
    type="button"
    onclick={openPurchaseSheet}
  >
    Выбрать тариф
  </button>
</dialog>
