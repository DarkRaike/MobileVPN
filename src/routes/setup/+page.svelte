<script lang="ts">
  import { resolve } from "$app/paths";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import AuthGate from "$lib/features/auth/AuthGate.svelte";

  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
  let copyMessage = $state<string | null>(null);
  const subscription = $derived(data.profileOverview.subscription);

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
</script>

<svelte:head>
  <title>Настройка VPN</title>
</svelte:head>

{#if !data.user}
  <AuthGate developmentMockAuthEnabled={data.developmentMockAuthEnabled} />
{:else}
  <main class="setup-page">
    <header class="setup-header">
      <a
        class="grid h-11 w-11 place-items-center rounded-[15px] bg-[color:var(--color-card)] text-[color:var(--color-text)]"
        href={resolve("/")}
        aria-label="Вернуться на главную"
      >
        <span class="rotate-180"><AppIcon name="arrow" size={21} /></span>
      </a>
      <div>
        <p class="text-sm text-[color:var(--color-muted)]">Подключение</p>
        <h1 class="text-[24px] font-semibold">Настроить VPN</h1>
      </div>
    </header>

    {#if subscription.status === "active"}
      <section class="surface rounded-[28px] p-5">
        <span class="setup-icon"><AppIcon name="download" size={25} /></span>
        <h2 class="mt-4 text-[21px] font-semibold">Подключите устройство</h2>
        <ol class="setup-steps">
          <li>Скачайте Happ на ваше устройство.</li>
          <li>Откройте сканер QR-кодов в приложении.</li>
          <li>Отсканируйте код или вставьте ссылку вручную.</li>
        </ol>

        {#if subscription.qrCodeDataUrl}
          <img
            class="setup-qr"
            src={subscription.qrCodeDataUrl}
            alt="QR-код ссылки подключения"
            width="196"
            height="196"
          />
        {:else}
          <p
            class="mt-5 rounded-[15px] bg-[color:var(--color-card-raised)] px-3 py-3 text-center text-xs text-[color:var(--color-muted)]"
          >
            QR-код недоступен. Используйте ссылку ниже.
          </p>
        {/if}

        <button class="setup-link" type="button" onclick={copySubscriptionUrl}>
          <span class="min-w-0 flex-1 truncate"
            >{subscription.subscriptionUrl}</span
          >
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
      </section>
    {:else if subscription.status === "provisioning" || subscription.status === "provisioning_failed"}
      <section class="surface rounded-[28px] p-5">
        <span class="setup-icon"><AppIcon name="shield" size={25} /></span>
        <h2 class="mt-4 text-[21px] font-semibold">Доступ ещё создаётся</h2>
        <p class="mt-2 text-sm leading-6 text-[color:var(--color-muted)]">
          Оплата получена. Вернитесь позже — QR-код появится автоматически.
        </p>
      </section>
    {:else}
      <section class="surface rounded-[28px] p-5">
        <span class="setup-icon"><AppIcon name="shield" size={25} /></span>
        <h2 class="mt-4 text-[21px] font-semibold">Сначала выберите тариф</h2>
        <p class="mt-2 text-sm leading-6 text-[color:var(--color-muted)]">
          После подтверждённой оплаты здесь появятся QR-код и ссылка
          подключения.
        </p>
        <a
          class="mt-5 flex min-h-12 items-center justify-center rounded-[16px] bg-[color:var(--color-accent)] px-4 py-3 text-sm font-semibold text-[color:var(--color-button-text)]"
          href={resolve("/")}
        >
          Выбрать тариф
        </a>
      </section>
    {/if}
  </main>
{/if}
