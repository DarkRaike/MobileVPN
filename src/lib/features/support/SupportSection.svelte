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
  let dismissedTicketNumber = $state<string | null>(null);

  const sentTicketNumber = $derived(
    feedback?.action === "support" &&
      feedback.ok &&
      feedback.publicNumber &&
      feedback.publicNumber !== dismissedTicketNumber
      ? feedback.publicNumber
      : null,
  );

  const enhanceTicket: SubmitFunction = () => {
    submitting = true;

    return async ({ result, update }) => {
      await update({ reset: result.type === "success" });
      submitting = false;
    };
  };
</script>

<header class="mb-5">
  <h1 id="section-heading-support" class="lg-h1" tabindex="-1">Поддержка</h1>
</header>

<h2 class="lg-eyebrow mx-0.5 mb-2.5">Частые вопросы</h2>

{#if faqItems.length === 0}
  <article class="lg-list px-4 py-[13px]">
    <p class="m-0 text-sm font-medium">Пока нет опубликованных ответов</p>
    <p class="mt-1 mb-0 text-[11.5px] leading-5 text-[color:var(--muted)]">
      Задайте вопрос через форму ниже.
    </p>
  </article>
{:else}
  <div class="lg-list px-4 py-1">
    {#each faqItems as faq (faq.id)}
      <details class="faq-item">
        <summary
          class="faq-toggle flex cursor-pointer list-none [&::-webkit-details-marker]:hidden"
        >
          <span class="flex-1 text-sm leading-[1.35] font-medium">
            {faq.question}
          </span>
          <span class="faq-chevron">
            <AppIcon name="arrow" size={18} />
          </span>
        </summary>
        <p
          class="mt-0 mb-3.5 text-[13px] leading-relaxed whitespace-pre-line text-[color:var(--muted)]"
        >
          {faq.answer}
        </p>
      </details>
    {/each}
  </div>
{/if}

<h2 class="lg-eyebrow mx-0.5 mt-5 mb-2.5">Написать нам</h2>
<article class="surface p-[18px]">
  {#if sentTicketNumber}
    <span class="lg-icon-badge h-11 w-11 rounded-[16px]">
      <AppIcon name="check" size={20} />
    </span>
    <h3 class="mt-3.5 mb-0 text-lg font-medium">Обращение отправлено</h3>
    <p class="mt-1.5 mb-0 text-[13px] leading-normal text-[color:var(--muted)]">
      Номер обращения {sentTicketNumber}. Ответим в Telegram в ближайшее время.
    </p>
    <button
      class="lg-btn-glass mt-4 min-h-[46px] w-full"
      type="button"
      onclick={() => (dismissedTicketNumber = sentTicketNumber)}
    >
      Новое обращение
    </button>
  {:else}
    <form
      method="POST"
      action="?/createTicket"
      class="flex flex-col gap-2.5"
      use:enhance={enhanceTicket}
    >
      <label class="sr-only" for="support-subject">Тема обращения</label>
      <input
        id="support-subject"
        name="subject"
        type="text"
        required
        minlength="3"
        maxlength="120"
        placeholder="Тема обращения"
        class="form-control"
        disabled={submitting}
      />
      <label class="sr-only" for="support-message">Описание проблемы</label>
      <textarea
        id="support-message"
        name="message"
        required
        minlength="10"
        maxlength="4000"
        rows="4"
        placeholder="Опишите проблему — что не работает и на каком устройстве"
        class="form-control resize-none rounded-[18px] leading-normal"
        disabled={submitting}></textarea>

      {#if feedback?.action === "support" && !feedback.ok}
        <p class="lg-error" role="alert">{feedback.message}</p>
      {/if}

      <button
        class="lg-btn-primary min-h-[50px] w-full text-[14.5px]"
        type="submit"
        disabled={submitting}
      >
        {submitting ? "Отправляем…" : "Отправить"}
      </button>
      <p class="m-0 text-[11.5px] leading-[1.45] text-[color:var(--faint)]">
        Тема — от 3 символов, описание — от 10. Мы не запрашиваем пароли и
        ссылки подписки.
      </p>
    </form>
  {/if}
</article>
