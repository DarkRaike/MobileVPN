<script lang="ts">
  import AppIcon from "$lib/components/AppIcon.svelte";
</script>

<header class="mb-6 flex items-center justify-between">
  <div>
    <p class="text-sm text-[color:var(--color-muted)]">Помощь</p>
    <h1
      id="section-heading-support"
      class="text-[27px] font-semibold tracking-[-0.03em]"
      tabindex="-1"
    >
      Поддержка
    </h1>
  </div>
  <span
    class="header-pill grid h-12 w-12 place-items-center rounded-[18px] text-[color:var(--color-accent)]"
  >
    <AppIcon name="headset" size={23} />
  </span>
</header>

<h2 class="mb-3 text-[21px] font-semibold">Мы на связи</h2>
<article class="surface mb-6 overflow-hidden rounded-[27px]">
  <div class="flex items-center gap-3 p-4">
    <span
      class="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-[color:color-mix(in_srgb,var(--color-accent)_11%,transparent)] text-[color:var(--color-accent)]"
    >
      <AppIcon name="support" size={27} />
    </span>
    <div class="min-w-0 flex-1">
      <p class="font-semibold">Центр поддержки</p>
      <p class="mt-1 text-sm text-[color:var(--color-muted)]">
        Канал обращений готовится
      </p>
    </div>
    <span
      class="h-3 w-3 rounded-full bg-[color:var(--color-accent)] shadow-[0_0_13px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]"
    ></span>
  </div>
  <div
    class="flex items-center justify-between border-t border-[color:var(--color-border)] px-5 py-3 text-sm text-[color:var(--color-muted)]"
  >
    <span>Статус</span>
    <span>Раздел подключён</span>
  </div>
</article>

<div class="mb-3 flex items-center justify-between">
  <h2 class="text-[21px] font-semibold">Частые вопросы</h2>
  <span class="text-sm text-[color:var(--color-muted)]">FAQ</span>
</div>

<article class="surface mb-6 rounded-[24px] p-5">
  <span
    class="grid h-11 w-11 place-items-center rounded-[15px] bg-[color:var(--color-card-raised)] text-[color:var(--color-accent)]"
  >
    <AppIcon name="shield" size={23} />
  </span>
  <h3 class="mt-4 text-[17px] font-semibold">
    Пока нет опубликованных ответов
  </h3>
  <p class="mt-1 text-sm leading-6 text-[color:var(--color-muted)]">
    FAQ появятся после подключения административного раздела.
  </p>
</article>

<h2 class="mb-1 text-[21px] font-semibold">Новое обращение</h2>
<p class="mb-3 text-sm text-[color:var(--color-muted)]">
  Отправка обращений будет доступна на этапе каталога и админки
</p>
<article class="surface rounded-[24px] p-5">
  <div class="flex items-start gap-3">
    <span
      class="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-[color:var(--color-card-raised)] text-[color:var(--color-muted)]"
    >
      <AppIcon name="clock" size={20} />
    </span>
    <div>
      <h3 class="font-semibold">Форма ещё не подключена</h3>
      <p class="mt-1 text-sm leading-6 text-[color:var(--color-muted)]">
        Интерфейс не отправляет тестовые или несохранённые сообщения.
      </p>
    </div>
  </div>
</article>
