<script lang="ts">
  import type { AuthenticatedUser } from "$lib/server/auth/sessions";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import UserAvatar from "$lib/components/UserAvatar.svelte";

  let {
    onNavigate,
    user,
  }: {
    onNavigate: (index: number) => void;
    user: AuthenticatedUser;
  } = $props();
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
        Всё готово к старту
      </h2>
    </div>
    <span
      class="inline-flex min-h-8 items-center gap-2 rounded-full bg-[color:color-mix(in_srgb,var(--color-accent)_10%,transparent)] px-3 text-[10px] font-semibold tracking-[0.05em] text-[color:var(--color-accent)]"
    >
      <span
        class="h-2 w-2 rounded-full bg-[color:var(--color-accent)] shadow-[0_0_10px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]"
      ></span>
      СЕССИЯ АКТИВНА
    </span>
  </div>

  <span
    class="connect-orb mx-auto grid h-[88px] w-[88px] place-items-center rounded-full"
  >
    <AppIcon name="shield" size={38} />
  </span>
  <p class="mt-5 text-[18px] font-semibold">Безопасный вход выполнен</p>
  <p class="mt-1 text-sm text-[color:var(--color-muted)]">
    Каталог тарифов появится на следующем этапе
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

<article class="surface rounded-[24px] p-5">
  <span
    class="grid h-11 w-11 place-items-center rounded-[15px] bg-[color:var(--color-card-raised)] text-[color:var(--color-accent)]"
  >
    <AppIcon name="spark" size={23} />
  </span>
  <h3 class="mt-4 text-[17px] font-semibold">Каталог пока пуст</h3>
  <p class="mt-1 text-sm leading-6 text-[color:var(--color-muted)]">
    Тарифы будут загружаться с сервера после реализации каталога и админки.
  </p>
</article>
