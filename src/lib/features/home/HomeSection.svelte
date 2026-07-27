<script lang="ts">
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { SvelteMap } from "svelte/reactivity";

  import type { AuthenticatedUser } from "$lib/server/auth/sessions";
  import type {
    AppActionFeedback,
    CatalogPlan,
  } from "$lib/features/catalog/types";
  import {
    getTelegramWebApp,
    isTelegramVersionAtLeast,
  } from "$lib/telegram/web-app";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import UserAvatar from "$lib/components/UserAvatar.svelte";

  let {
    feedback,
    onNavigate,
    plans,
    purchasesEnabled,
    user,
  }: {
    feedback: AppActionFeedback | null;
    onNavigate: (index: number) => void;
    plans: CatalogPlan[];
    purchasesEnabled: boolean;
    user: AuthenticatedUser;
  } = $props();

  let expandedPlanId = $state<string | null | undefined>(undefined);
  let purchaseMessage = $state<string | null>(null);
  let submittingPlanId = $state<string | null>(null);
  let termsAccepted = $state(false);
  const purchaseAttemptKeys = new SvelteMap<string, string>();
  const featuredPlanId = $derived(
    plans.find((plan) => plan.isFeatured)?.id ?? null,
  );
  const activeExpandedPlanId = $derived(
    expandedPlanId === undefined ? featuredPlanId : expandedPlanId,
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

  function togglePlan(planId: string): void {
    expandedPlanId = activeExpandedPlanId === planId ? null : planId;
  }

  function getStoredPromoCode(): string {
    try {
      return sessionStorage.getItem("astra_promo_code") ?? "";
    } catch {
      return "";
    }
  }

  function enhancePurchase(planId: string): SubmitFunction {
    return ({ cancel, formData }) => {
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
          void invalidateAll();
        });
      };
    };
  }
</script>

<header class="mb-5 flex items-center justify-between gap-4">
  <div class="flex min-w-0 items-center gap-3">
    <UserAvatar {user} />
    <div class="min-w-0">
      <p class="text-xs font-medium text-[color:var(--color-muted)]">
        Добро пожаловать
      </p>
      <h1
        id="section-heading-home"
        class="truncate text-[21px] font-semibold"
        tabindex="-1"
      >
        {user.firstName}
      </h1>
    </div>
  </div>
  <span
    class="header-pill grid h-12 w-12 shrink-0 place-items-center rounded-[18px] text-[color:var(--color-accent)]"
    aria-label="Защищённая сессия"
  >
    <AppIcon name="lock" size={22} />
  </span>
</header>

<article class="hero-grid surface mb-3 rounded-[28px] px-5 py-6 text-center">
  <div class="mb-5 flex items-center justify-between gap-4 text-left">
    <div>
      <p
        class="text-xs font-semibold tracking-[0.12em] text-[color:var(--color-accent)] uppercase"
      >
        Astra VPN
      </p>
      <h2 class="mt-1 text-[21px] leading-tight font-semibold">
        Выберите свой тариф
      </h2>
    </div>
    <span
      class="inline-flex min-h-8 items-center gap-2 rounded-full bg-[color:color-mix(in_srgb,var(--color-accent)_10%,transparent)] px-3 text-[10px] font-semibold tracking-[0.05em] text-[color:var(--color-accent)]"
    >
      <span
        class="h-2 w-2 rounded-full bg-[color:var(--color-accent)] shadow-[0_0_10px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]"
      ></span>
      КАТАЛОГ ДОСТУПЕН
    </span>
  </div>

  <span
    class="connect-orb mx-auto grid h-[88px] w-[88px] place-items-center rounded-full"
  >
    <AppIcon name="shield" size={38} />
  </span>
  <p class="mt-5 text-[18px] font-semibold">Безлимитный трафик</p>
  <p class="mt-1 text-sm text-[color:var(--color-muted)]">
    До трёх личных устройств
  </p>
</article>

<div class="mb-6 grid grid-cols-2 gap-2.5">
  <button
    class="surface min-h-24 rounded-[21px] px-3 py-4 text-left transition active:scale-[0.98]"
    type="button"
    onclick={() => onNavigate(0)}
  >
    <span
      class="mb-3 grid h-10 w-10 place-items-center rounded-[14px] bg-[color:color-mix(in_srgb,var(--color-accent)_11%,transparent)] text-[color:var(--color-accent)]"
    >
      <AppIcon name="headset" size={21} />
    </span>
    <span class="block text-sm font-semibold">Поддержка</span>
    <span class="mt-1 block text-xs text-[color:var(--color-muted)]">
      Помощь и FAQ
    </span>
  </button>

  <button
    class="surface min-h-24 rounded-[21px] px-3 py-4 text-left transition active:scale-[0.98]"
    type="button"
    onclick={() => onNavigate(2)}
  >
    <span
      class="mb-3 grid h-10 w-10 place-items-center rounded-[14px] bg-[color:color-mix(in_srgb,var(--color-accent)_11%,transparent)] text-[color:var(--color-accent)]"
    >
      <AppIcon name="profile" size={21} />
    </span>
    <span class="block text-sm font-semibold">Профиль</span>
    <span class="mt-1 block text-xs text-[color:var(--color-muted)]">
      Аккаунт и сессия
    </span>
  </button>
</div>

<div class="mb-3 flex items-center justify-between">
  <h2 class="text-[21px] font-semibold">Тарифы</h2>
  <span class="text-xs text-[color:var(--color-muted)]">до 3 устройств</span>
</div>

<label
  class="surface mb-3 flex min-h-14 cursor-pointer items-start gap-3 rounded-[18px] px-4 py-3 text-sm leading-5"
>
  <input
    class="mt-0.5 h-5 w-5 shrink-0 accent-[color:var(--color-accent)]"
    type="checkbox"
    bind:checked={termsAccepted}
    disabled={!purchasesEnabled}
  />
  <span>
    <span class="block font-semibold">Подтверждаю условия покупки</span>
    <span class="mt-0.5 block text-xs text-[color:var(--color-muted)]">
      Одноразовый платёж Telegram Stars. Автопродления нет.
    </span>
  </span>
</label>

{#if feedback?.action === "purchase" || purchaseMessage}
  <div
    class:feedback-error={feedback?.action === "purchase" && !feedback.ok}
    class:feedback-success={feedback?.action !== "purchase" || feedback.ok}
    class="mb-3 rounded-[16px] px-4 py-3 text-sm"
    role={feedback?.action === "purchase" && !feedback.ok ? "alert" : "status"}
  >
    {purchaseMessage ?? feedback?.message}
  </div>
{/if}

{#if !purchasesEnabled}
  <p class="mb-3 text-xs leading-5 text-[color:var(--color-muted)]">
    Реальные платежи отключены до прохождения production gates.
  </p>
{/if}

{#if plans.length === 0}
  <article class="surface rounded-[24px] p-5">
    <span
      class="grid h-11 w-11 place-items-center rounded-[15px] bg-[color:var(--color-card-raised)] text-[color:var(--color-accent)]"
    >
      <AppIcon name="spark" size={23} />
    </span>
    <h3 class="mt-4 text-[17px] font-semibold">Нет доступных тарифов</h3>
    <p class="mt-1 text-sm leading-6 text-[color:var(--color-muted)]">
      Каталог временно пуст. Попробуйте обновить приложение позже.
    </p>
  </article>
{:else}
  <div class="space-y-2.5">
    {#each plans as plan (plan.id)}
      {@const preview = promoPreviewByPlan.get(plan.id)}
      <article class:open={activeExpandedPlanId === plan.id} class="tariff">
        <div
          class="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 gap-y-[5px] px-3.5 pt-3.5 pb-[5px]"
        >
          <button
            class="min-h-11 min-w-0 text-left"
            type="button"
            aria-expanded={activeExpandedPlanId === plan.id}
            onclick={() => togglePlan(plan.id)}
          >
            <span class="block text-[19px] font-semibold">
              {plan.name}
            </span>
            <span class="mt-0.5 block text-xs text-[color:var(--color-muted)]">
              {plan.durationDays} дней
            </span>
          </button>
          <span class="text-right whitespace-nowrap">
            {#if preview}
              <span
                class="block text-xs text-[color:var(--color-muted)] line-through"
              >
                {plan.priceStars} ⭐
              </span>
              <span class="block text-[18px] font-semibold">
                {preview.totalStars} ⭐
              </span>
            {:else}
              <span class="block text-[18px] font-semibold">
                {plan.priceStars} ⭐
              </span>
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
              class="min-h-11 min-w-[92px] rounded-[14px] bg-[color:var(--color-text)] px-4 py-3 text-sm font-semibold text-[color:var(--color-app)] transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-45"
              type="submit"
              disabled={!purchasesEnabled ||
                !termsAccepted ||
                submittingPlanId !== null}
            >
              {submittingPlanId === plan.id ? "Счёт…" : "Купить"}
            </button>
          </form>
          <button
            class="col-span-3 flex min-h-11 items-center justify-center text-[color:var(--color-muted)]"
            type="button"
            aria-label={activeExpandedPlanId === plan.id
              ? `Скрыть описание тарифа ${plan.name}`
              : `Показать описание тарифа ${plan.name}`}
            aria-expanded={activeExpandedPlanId === plan.id}
            onclick={() => togglePlan(plan.id)}
          >
            <span class="tariff-chevron">
              <AppIcon name="arrow" size={20} />
            </span>
          </button>
        </div>
        <div class="tariff-details">
          <div class="overflow-hidden">
            <div
              class="space-y-2 border-t border-[color:var(--color-border)] px-4 py-3 text-sm leading-6 text-[color:var(--color-muted)]"
            >
              {#if plan.isFeatured}
                <span
                  class="inline-flex rounded-full bg-[color:color-mix(in_srgb,var(--color-accent)_12%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-[color:var(--color-accent)]"
                >
                  Рекомендуем
                </span>
              {/if}
              <p>{plan.description ?? "Безлимитный VPN-доступ"}</p>
              <ul class="list-inside list-disc">
                <li>Безлимитный трафик</li>
                <li>До 3 личных устройств</li>
                <li>Современное шифрование VLESS</li>
              </ul>
              {#if preview}
                <p class="text-xs text-[color:var(--color-accent)]">
                  Скидка {preview.discountStars} Stars применится на сервере.
                </p>
              {/if}
            </div>
          </div>
        </div>
      </article>
    {/each}
  </div>
{/if}
