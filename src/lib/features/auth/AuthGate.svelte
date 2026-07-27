<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { onMount } from "svelte";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import { getTelegramWebApp } from "$lib/telegram/web-app";

  let {
    developmentMockAuthEnabled,
  }: {
    developmentMockAuthEnabled: boolean;
  } = $props();

  let status = $state<"authenticating" | "error" | "outside">("authenticating");
  let message = $state("Подтверждаем данные Telegram…");

  async function authenticate(): Promise<void> {
    const webApp = getTelegramWebApp();
    const initData = webApp?.initData ?? "";

    if (!initData && !developmentMockAuthEnabled) {
      status = "outside";
      message = webApp
        ? "Telegram не передал данные запуска. Закройте и откройте Mini App снова."
        : "Это приложение доступно только внутри Telegram.";
      return;
    }

    status = "authenticating";
    message = "Подтверждаем данные Telegram…";

    try {
      const response = await fetch("/api/auth/telegram", {
        body: JSON.stringify({ initData }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "object" &&
          payload.error !== null &&
          "message" in payload.error &&
          typeof payload.error.message === "string"
            ? payload.error.message
            : "Не удалось войти. Попробуйте ещё раз.";
        status = "error";
        return;
      }

      await invalidateAll();
    } catch {
      status = "error";
      message = "Не удалось связаться с сервером. Проверьте подключение.";
    }
  }

  onMount(() => {
    void authenticate();
  });
</script>

<main class="auth-shell">
  <section class="surface w-full max-w-[390px] rounded-[30px] p-6 text-center">
    <span
      class="mx-auto grid h-[82px] w-[82px] place-items-center rounded-[26px] border border-[color:var(--color-border)] bg-[color:var(--color-card-raised)] text-[color:var(--color-accent)] shadow-[0_20px_50px_rgb(0_0_0/20%)]"
    >
      <AppIcon name="shield" size={38} />
    </span>

    <p
      class="mt-6 text-xs font-semibold tracking-[0.16em] text-[color:var(--color-accent)] uppercase"
    >
      Astra VPN
    </p>
    <h1 class="mt-2 text-[26px] leading-tight font-semibold tracking-[-0.03em]">
      Безопасный вход
    </h1>
    <p
      class="mx-auto mt-3 max-w-[290px] text-sm leading-6 text-[color:var(--color-muted)]"
    >
      {message}
    </p>

    {#if status === "authenticating"}
      <span
        class="mx-auto mt-6 block h-7 w-7 animate-spin rounded-full border-2 border-[color:var(--color-border)] border-t-[color:var(--color-accent)]"
        aria-label="Авторизация"
      ></span>
    {:else}
      <button
        class="mt-6 min-h-11 w-full rounded-[16px] bg-[color:var(--color-accent)] px-4 py-3 text-sm font-semibold text-[color:var(--color-button-text)] transition active:scale-[0.985]"
        type="button"
        onclick={() => void authenticate()}
      >
        {status === "outside" ? "Проверить снова" : "Повторить вход"}
      </button>
    {/if}

    {#if developmentMockAuthEnabled}
      <p class="mt-4 text-xs text-[color:var(--color-muted)]">
        Development mock включён локально
      </p>
    {/if}
  </section>
</main>
