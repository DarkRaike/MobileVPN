<script lang="ts">
  import { enhance } from "$app/forms";

  import type { AuthenticatedUser } from "$lib/server/auth/sessions";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import UserAvatar from "$lib/components/UserAvatar.svelte";

  let {
    sessionExpiresAt,
    user,
  }: {
    sessionExpiresAt: Date | null;
    user: AuthenticatedUser;
  } = $props();

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
  <div class="min-w-0">
    <h2 class="truncate text-[19px] font-semibold">{fullName}</h2>
    {#if user.username}
      <p class="mt-0.5 truncate text-sm text-[color:var(--color-muted)]">
        @{user.username}
      </p>
    {:else}
      <p class="mt-0.5 text-sm text-[color:var(--color-muted)]">
        Username не указан
      </p>
    {/if}
  </div>
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
    Здесь появятся срок, Subscription URL и QR-код после подтверждённой оплаты.
  </p>
</article>

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
