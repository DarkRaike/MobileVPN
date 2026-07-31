<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import { onMount } from "svelte";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import { getTelegramWebApp } from "$lib/telegram/web-app";

  let {
    developmentMockAuthEnabled,
    overlay = false,
  }: {
    developmentMockAuthEnabled: boolean;
    overlay?: boolean;
  } = $props();

  let initialized = $state(false);
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
    initialized = true;
    void authenticate();
  });
</script>

{#if !overlay}
  <main class="auth-shell">
    <section
      class="surface w-full max-w-[390px] rounded-[30px] p-6 text-center"
    >
      <span class="lg-icon-badge mx-auto h-[82px] w-[82px] rounded-[26px]">
        <AppIcon name="shield" size={38} />
      </span>

      <h1 class="mt-4 text-[26px] leading-tight font-medium tracking-[-0.03em]">
        Безопасный вход
      </h1>
      <p
        class="mx-auto mt-3 max-w-[290px] text-sm leading-6 text-[color:var(--muted)]"
      >
        {message}
      </p>

      {#if status === "authenticating"}
        <span
          class="mx-auto mt-6 block h-7 w-7 animate-spin rounded-full border-2 border-[color:var(--glass-edge)] border-t-[color:var(--accent-deep)]"
          aria-label="Авторизация"
        ></span>
      {:else}
        <button
          class="lg-btn-primary mt-6 w-full text-sm"
          type="button"
          onclick={() => void authenticate()}
        >
          {status === "outside" ? "Проверить снова" : "Повторить вход"}
        </button>
      {/if}

      {#if developmentMockAuthEnabled}
        <p class="mt-4 text-xs text-[color:var(--muted)]">
          Development mock включён локально
        </p>
      {/if}
    </section>
  </main>
{:else if initialized && status !== "outside"}
  <aside class="auth-overlay" aria-live="polite">
    <section class="surface auth-overlay-card rounded-[24px] p-5 text-center">
      {#if status === "authenticating"}
        <span
          class="mx-auto block h-7 w-7 animate-spin rounded-full border-2 border-[color:var(--glass-edge)] border-t-[color:var(--accent-deep)]"
          aria-label="Авторизация"
        ></span>
        <p class="mt-4 text-sm text-[color:var(--muted)]">{message}</p>
      {:else}
        <p class="text-sm leading-6 text-[color:var(--muted)]">
          {message}
        </p>
        <button
          class="lg-btn-primary mt-4 w-full text-sm"
          type="button"
          onclick={() => void authenticate()}
        >
          Повторить вход
        </button>
      {/if}
    </section>
  </aside>
{/if}
