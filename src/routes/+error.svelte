<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";

  import AppIcon from "$lib/components/AppIcon.svelte";
</script>

<svelte:head>
  <title>Ошибка</title>
</svelte:head>

<main class="auth-shell">
  <section class="surface w-full max-w-[390px] rounded-[30px] p-6 text-center">
    <span class="lg-icon-badge mx-auto h-16 w-16 rounded-[22px]">
      <AppIcon name="shield" size={30} />
    </span>
    <p class="lg-eyebrow mt-5">Ошибка {page.status}</p>
    <h1 class="mt-2 text-2xl font-medium tracking-[-0.02em]">
      Что-то пошло не так
    </h1>
    <p class="mt-3 text-sm leading-6 text-[color:var(--muted)]">
      {page.error?.message ?? "Не удалось загрузить приложение."}
    </p>
    <a class="lg-btn-primary mt-6 w-full text-sm" href={resolve("/")}>
      Попробовать снова
    </a>
  </section>
</main>
