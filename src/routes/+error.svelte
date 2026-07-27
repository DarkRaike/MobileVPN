<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";

  import AppIcon from "$lib/components/AppIcon.svelte";
</script>

<svelte:head>
  <title>Ошибка · Astra VPN</title>
</svelte:head>

<main class="auth-shell">
  <section class="surface w-full max-w-[390px] rounded-[30px] p-6 text-center">
    <span
      class="mx-auto grid h-16 w-16 place-items-center rounded-[22px] bg-[color:var(--color-card-raised)] text-[color:var(--color-accent)]"
    >
      <AppIcon name="shield" size={30} />
    </span>
    <p
      class="mt-5 text-xs font-semibold tracking-[0.14em] text-[color:var(--color-muted)] uppercase"
    >
      Ошибка {page.status}
    </p>
    <h1 class="mt-2 text-2xl font-semibold">Что-то пошло не так</h1>
    <p class="mt-3 text-sm leading-6 text-[color:var(--color-muted)]">
      {page.error?.message ?? "Не удалось загрузить приложение."}
    </p>
    <a
      class="mt-6 inline-flex min-h-11 w-full items-center justify-center rounded-[16px] bg-[color:var(--color-accent)] px-4 py-3 text-sm font-semibold text-[color:var(--color-button-text)]"
      href={resolve("/")}
    >
      Попробовать снова
    </a>
  </section>
</main>
