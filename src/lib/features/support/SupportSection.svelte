<script lang="ts">
  import { enhance } from "$app/forms";
  import type { SubmitFunction } from "@sveltejs/kit";

  import type { AppActionFeedback, FaqItem } from "$lib/features/catalog/types";
  import AppIcon from "$lib/components/AppIcon.svelte";

  let {
    faqItems,
    feedback,
  }: {
    faqItems: FaqItem[];
    feedback: AppActionFeedback | null;
  } = $props();

  let submitting = $state(false);

  const enhanceTicket: SubmitFunction = () => {
    submitting = true;

    return async ({ result, update }) => {
      await update({ reset: result.type === "success" });
      submitting = false;
    };
  };
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
      class="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-[color:var(--color-card-raised)] text-[color:var(--color-muted)]"
    >
      <AppIcon name="support" size={27} />
    </span>
    <div class="min-w-0 flex-1">
      <p class="font-semibold">Центр поддержки</p>
      <p class="mt-1 text-sm text-[color:var(--color-muted)]">
        Ответ придёт в Telegram
      </p>
    </div>
    <span class="h-2.5 w-2.5 rounded-full bg-[#55c98b]"></span>
  </div>
  <div
    class="flex items-center justify-between border-t border-[color:var(--color-border)] px-5 py-3 text-sm text-[color:var(--color-muted)]"
  >
    <span>Обращения</span>
    <span>Сохраняются на сервере</span>
  </div>
</article>

<div class="mb-3 flex items-center justify-between">
  <h2 class="text-[21px] font-semibold">Частые вопросы</h2>
  <span class="text-sm text-[color:var(--color-muted)]">FAQ</span>
</div>

{#if faqItems.length === 0}
  <article class="surface mb-6 rounded-[24px] p-5">
    <h3 class="font-semibold">Пока нет опубликованных ответов</h3>
    <p class="mt-1 text-sm leading-6 text-[color:var(--color-muted)]">
      Задайте вопрос через форму ниже.
    </p>
  </article>
{:else}
  <div class="mb-6 space-y-2.5">
    {#each faqItems as faq (faq.id)}
      <details class="faq surface rounded-[22px]">
        <summary
          class="flex min-h-14 cursor-pointer list-none items-center gap-3 p-4"
        >
          <span
            class="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-[color:color-mix(in_srgb,var(--color-accent)_11%,transparent)] text-[color:var(--color-accent)]"
          >
            <AppIcon name="shield" size={20} />
          </span>
          <span class="flex-1 font-medium">{faq.question}</span>
          <span class="faq-chevron text-[color:var(--color-muted)]">
            <AppIcon name="arrow" size={20} />
          </span>
        </summary>
        <p
          class="border-t border-[color:var(--color-border)] px-4 py-4 text-sm leading-6 whitespace-pre-line text-[color:var(--color-muted)]"
        >
          {faq.answer}
        </p>
      </details>
    {/each}
  </div>
{/if}

<h2 class="mb-1 text-[21px] font-semibold">Новое обращение</h2>
<p class="mb-3 text-sm text-[color:var(--color-muted)]">
  Укажите тему и подробно опишите проблему
</p>

{#if feedback?.action === "support"}
  <div
    class:feedback-error={!feedback.ok}
    class:feedback-success={feedback.ok}
    class="mb-3 rounded-[16px] px-4 py-3 text-sm"
    role={feedback.ok ? "status" : "alert"}
  >
    {feedback.message}
  </div>
{/if}

<form
  method="POST"
  action="?/createTicket"
  class="surface space-y-3 rounded-[27px] p-4"
  use:enhance={enhanceTicket}
>
  <label class="sr-only" for="support-subject">Тема обращения</label>
  <select
    id="support-subject"
    name="subject"
    required
    class="form-control"
    disabled={submitting}
  >
    <option value="">Выберите тему</option>
    <option>Проблема с подключением</option>
    <option>Оплата и подписка</option>
    <option>Другое</option>
  </select>
  <label class="sr-only" for="support-message">Описание проблемы</label>
  <textarea
    id="support-message"
    name="message"
    required
    minlength="10"
    maxlength="4000"
    rows="5"
    placeholder="Опишите проблему"
    class="form-control resize-none"
    disabled={submitting}></textarea>
  <button
    class="min-h-12 w-full rounded-[16px] bg-[color:var(--color-accent)] px-4 py-3.5 font-semibold text-[color:var(--color-button-text)] transition active:scale-[0.985] disabled:cursor-wait disabled:opacity-60"
    type="submit"
    disabled={submitting}
  >
    {submitting ? "Отправляем…" : "Отправить обращение"}
  </button>
</form>
