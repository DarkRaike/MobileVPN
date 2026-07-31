<script lang="ts">
  import { resolve } from "$app/paths";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import AuthGate from "$lib/features/auth/AuthGate.svelte";
  import ThemeBridge from "$lib/telegram/ThemeBridge.svelte";

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
      copyMessage = "Ссылка подписки скопирована";
    } catch {
      copyMessage = "Не удалось скопировать ссылку";
    }
  }
</script>

<svelte:head>
  <title>Настройка VPN</title>
</svelte:head>

<ThemeBridge />

{#if !data.user}
  <AuthGate developmentMockAuthEnabled={data.developmentMockAuthEnabled} />
{:else}
  <main class="setup-page">
    <header class="setup-header">
      <a class="lg-btn-glass setup-back" href={resolve("/")} aria-label="Назад">
        <span class="rotate-180"><AppIcon name="arrow" size={20} /></span>
      </a>
      <div>
        <p class="m-0 text-[12.5px] text-[color:var(--muted)]">Подключение</p>
        <h1 class="mt-[3px] mb-0 text-2xl font-medium tracking-[-0.02em]">
          Настроить VPN
        </h1>
      </div>
    </header>

    {#if subscription.status === "active"}
      <section class="surface p-[18px]">
        <div class="flex items-start gap-3">
          <span class="lg-icon-badge h-11 w-11 rounded-[16px]">
            <AppIcon name="download" size={21} />
          </span>
          <div>
            <h2 class="m-0 text-[19px] font-medium">Подключите устройство</h2>
            <p class="mt-[5px] mb-0 text-[12.5px] text-[color:var(--muted)]">
              Три шага, около минуты
            </p>
          </div>
        </div>

        <ol class="mt-4 flex list-none flex-col gap-2.5 p-0">
          <li class="setup-step">
            <span class="lg-btn-accent setup-step-number">1</span>
            <span
              >Скачайте приложение <strong class="font-semibold">Happ</strong
              ></span
            >
          </li>
          <li class="setup-step">
            <span class="lg-btn-accent setup-step-number">2</span>
            <span>Откройте в нём сканер QR-кодов</span>
          </li>
          <li class="setup-step">
            <span class="lg-btn-accent setup-step-number">3</span>
            <span>Отсканируйте код или вставьте ссылку</span>
          </li>
        </ol>

        {#if subscription.qrCodeDataUrl}
          <div class="setup-qr">
            <img
              src={subscription.qrCodeDataUrl}
              alt="QR-код ссылки подключения"
              width="188"
              height="188"
            />
          </div>
        {:else}
          <p class="lg-error mt-4 text-center">
            QR-код недоступен. Используйте ссылку ниже.
          </p>
        {/if}
        <p
          class="mt-3 mb-0 text-center text-[11.5px] text-[color:var(--faint)]"
        >
          Код и ссылка — личные. Не передавайте их другим.
        </p>

        <button
          class="setup-link mt-3.5"
          type="button"
          onclick={copySubscriptionUrl}
        >
          <span class="min-w-0 flex-1 truncate"
            >{subscription.subscriptionUrl}</span
          >
          <AppIcon name="copy" size={19} />
        </button>
        {#if copyMessage}
          <p
            class="mt-2 mb-0 text-center text-xs text-[color:var(--accent-deep)]"
            role="status"
          >
            {copyMessage}
          </p>
        {/if}
      </section>
    {:else if subscription.status === "provisioning" || subscription.status === "provisioning_failed"}
      <section class="surface p-[18px]">
        <span class="lg-icon-badge h-11 w-11 rounded-[16px]">
          <AppIcon name="shield" size={21} />
        </span>
        <h2 class="mt-3.5 mb-0 text-[19px] font-medium">
          Доступ ещё создаётся
        </h2>
        <p
          class="mt-1.5 mb-0 text-[13px] leading-normal text-[color:var(--muted)]"
        >
          Оплата получена. Вернитесь позже — QR-код появится автоматически.
        </p>
      </section>
    {:else}
      <section class="surface p-[18px]">
        <span class="lg-icon-badge h-11 w-11 rounded-[16px]">
          <AppIcon name="shield" size={21} />
        </span>
        <h2 class="mt-3.5 mb-0 text-[19px] font-medium">
          Сначала выберите тариф
        </h2>
        <p
          class="mt-1.5 mb-0 text-[13px] leading-normal text-[color:var(--muted)]"
        >
          QR-код и ссылка подключения появятся сразу после подтверждённой
          оплаты.
        </p>
        <a class="lg-btn-primary mt-4 w-full text-[14.5px]" href={resolve("/")}>
          Выбрать тариф
        </a>
      </section>
    {/if}
  </main>
{/if}
