<script lang="ts">
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { onMount } from "svelte";

  import type { AuthenticatedUser } from "$lib/server/auth/sessions";
  import type { AppActionFeedback } from "$lib/features/catalog/types";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import UserAvatar from "$lib/components/UserAvatar.svelte";

  let {
    feedback,
    isAdmin,
    sessionExpiresAt,
    user,
  }: {
    feedback: AppActionFeedback | null;
    isAdmin: boolean;
    sessionExpiresAt: Date | null;
    user: AuthenticatedUser;
  } = $props();

  let promoInput = $state("");
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

  const enhancePromo: SubmitFunction = () => {
    submittingPromo = true;

    return async ({ update }) => {
      await update({ reset: false });
      submittingPromo = false;
    };
  };

  onMount(() => {
    promoInput = sessionStorage.getItem("astra_promo_code") ?? "";
  });

  $effect(() => {
    const promoCode =
      feedback?.action === "promo" && feedback.ok
        ? feedback.promoCode?.code
        : undefined;

    if (promoCode && typeof sessionStorage !== "undefined") {
      sessionStorage.setItem("astra_promo_code", promoCode);
      promoInput = promoCode;
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
<article class="surface mb-6 rounded-[25px] p-5">
  <span
    class="grid h-12 w-12 place-items-center rounded-[16px] bg-[color:color-mix(in_srgb,var(--color-accent)_11%,transparent)] text-[color:var(--color-accent)]"
  >
    <AppIcon name="shield" size={25} />
  </span>
  <h3 class="mt-4 text-[19px] font-semibold">Активной подписки нет</h3>
  <p class="mt-1 text-sm leading-6 text-[color:var(--color-muted)]">
    Подписка, QR-код и ссылка подключения появятся после подтверждённой оплаты.
  </p>
</article>

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
