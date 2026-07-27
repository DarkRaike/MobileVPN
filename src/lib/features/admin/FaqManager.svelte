<script lang="ts">
  import { enhance } from "$app/forms";
  import type { SubmitFunction } from "@sveltejs/kit";

  import type { AdminFaq } from "./types";

  let { faqItems }: { faqItems: AdminFaq[] } = $props();
  let submittingKey = $state<string | null>(null);

  const enhanceForm: SubmitFunction = ({ formElement, submitter }) => {
    submittingKey = submitter?.dataset.key ?? "faq";

    return async ({ result, update }) => {
      await update({
        reset:
          result.type === "success" && formElement.dataset.reset === "true",
      });
      submittingKey = null;
    };
  };
</script>

<section aria-labelledby="admin-faq-heading">
  <div class="mb-4 flex items-end justify-between gap-4">
    <div>
      <p class="admin-eyebrow">Поддержка</p>
      <h2 id="admin-faq-heading" class="text-2xl font-semibold">FAQ</h2>
    </div>
    <span class="admin-count">{faqItems.length}</span>
  </div>

  <details class="admin-card mb-4">
    <summary class="admin-summary">Новый вопрос</summary>
    <form
      method="POST"
      action="?/createFaq"
      class="admin-form-grid border-t border-[color:var(--color-border)] p-4"
      data-reset="true"
      use:enhance={enhanceForm}
    >
      <label class="sm:col-span-2">
        <span>Вопрос</span>
        <input
          class="admin-input"
          name="question"
          required
          minlength="3"
          maxlength="240"
        />
      </label>
      <label class="sm:col-span-2">
        <span>Ответ</span>
        <textarea
          class="admin-input resize-y"
          name="answer"
          rows="5"
          required
          maxlength="10000"></textarea>
      </label>
      <label>
        <span>Порядок</span>
        <input
          class="admin-input"
          name="sortOrder"
          type="number"
          value="0"
          required
        />
      </label>
      <label class="admin-checkbox self-end pb-3">
        <input name="isPublished" type="checkbox" />
        Опубликован
      </label>
      <button
        class="admin-primary sm:col-span-2"
        type="submit"
        data-key="faq-create"
        disabled={submittingKey !== null}
      >
        {submittingKey === "faq-create" ? "Сохраняем…" : "Создать FAQ"}
      </button>
    </form>
  </details>

  {#if faqItems.length === 0}
    <div class="admin-empty">FAQ пока нет.</div>
  {:else}
    <div class="space-y-3">
      {#each faqItems as faq (faq.id)}
        <details class="admin-card">
          <summary class="admin-summary">
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">{faq.question}</span>
              <span class="mt-1 block text-xs text-[color:var(--color-muted)]">
                Порядок {faq.sortOrder}
              </span>
            </span>
            <span class:status-active={faq.isPublished} class="status-pill">
              {faq.isPublished ? "Опубликован" : "Черновик"}
            </span>
          </summary>

          <div class="border-t border-[color:var(--color-border)] p-4">
            <form
              method="POST"
              action="?/updateFaq"
              class="admin-form-grid"
              use:enhance={enhanceForm}
            >
              <input name="id" type="hidden" value={faq.id} />
              <label class="sm:col-span-2">
                <span>Вопрос</span>
                <input
                  class="admin-input"
                  name="question"
                  value={faq.question}
                  required
                  minlength="3"
                  maxlength="240"
                />
              </label>
              <label class="sm:col-span-2">
                <span>Ответ</span>
                <textarea
                  class="admin-input resize-y"
                  name="answer"
                  rows="5"
                  required
                  maxlength="10000">{faq.answer}</textarea
                >
              </label>
              <label>
                <span>Порядок</span>
                <input
                  class="admin-input"
                  name="sortOrder"
                  type="number"
                  value={faq.sortOrder}
                  required
                />
              </label>
              <label class="admin-checkbox self-end pb-3">
                <input
                  name="isPublished"
                  type="checkbox"
                  checked={faq.isPublished}
                />
                Опубликован
              </label>
              <button
                class="admin-primary sm:col-span-2"
                type="submit"
                data-key={`faq-update-${faq.id}`}
                disabled={submittingKey !== null}
              >
                {submittingKey === `faq-update-${faq.id}`
                  ? "Сохраняем…"
                  : "Сохранить изменения"}
              </button>
            </form>
            <form
              method="POST"
              action="?/deleteFaq"
              class="mt-3"
              use:enhance={enhanceForm}
            >
              <input name="id" type="hidden" value={faq.id} />
              <button
                class="admin-danger w-full"
                type="submit"
                data-key={`faq-delete-${faq.id}`}
                disabled={submittingKey !== null}
              >
                Удалить FAQ
              </button>
            </form>
          </div>
        </details>
      {/each}
    </div>
  {/if}
</section>
