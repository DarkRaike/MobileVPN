<script lang="ts">
  import { enhance } from "$app/forms";
  import type { SubmitFunction } from "@sveltejs/kit";

  import type { AdminPlan } from "./types";

  let { plans }: { plans: AdminPlan[] } = $props();
  let submittingKey = $state<string | null>(null);

  const enhanceForm: SubmitFunction = ({ formElement, submitter }) => {
    submittingKey = submitter?.dataset.key ?? "plan";

    return async ({ result, update }) => {
      await update({
        reset:
          result.type === "success" && formElement.dataset.reset === "true",
      });
      submittingKey = null;
    };
  };
</script>

<section aria-labelledby="admin-plans-heading">
  <div class="mb-4 flex items-end justify-between gap-4">
    <div>
      <p class="admin-eyebrow">Каталог</p>
      <h2 id="admin-plans-heading" class="text-2xl font-semibold">Тарифы</h2>
    </div>
    <span class="admin-count">{plans.length}</span>
  </div>

  <details class="admin-card mb-4" open>
    <summary class="admin-summary">Новый тариф</summary>
    <form
      method="POST"
      action="?/createPlan"
      class="admin-form-grid border-t border-[color:var(--color-border)] p-4"
      data-reset="true"
      use:enhance={enhanceForm}
    >
      <label>
        <span>Название</span>
        <input class="admin-input" name="name" required maxlength="120" />
      </label>
      <label>
        <span>Срок, дней</span>
        <input
          class="admin-input"
          name="durationDays"
          type="number"
          required
          min="1"
          max="365"
        />
      </label>
      <label>
        <span>Цена, Stars</span>
        <input
          class="admin-input"
          name="priceStars"
          type="number"
          required
          min="1"
        />
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
      <label class="sm:col-span-2">
        <span>Описание</span>
        <textarea
          class="admin-input resize-y"
          name="description"
          rows="3"
          maxlength="500"></textarea>
      </label>
      <div class="flex flex-wrap gap-4 sm:col-span-2">
        <label class="admin-checkbox">
          <input name="isActive" type="checkbox" checked />
          Активен
        </label>
        <label class="admin-checkbox">
          <input name="isFeatured" type="checkbox" />
          Рекомендуемый
        </label>
      </div>
      <button
        class="admin-primary sm:col-span-2"
        type="submit"
        data-key="plan-create"
        disabled={submittingKey !== null}
      >
        {submittingKey === "plan-create" ? "Сохраняем…" : "Создать тариф"}
      </button>
    </form>
  </details>

  {#if plans.length === 0}
    <div class="admin-empty">Тарифов пока нет. Создайте первый выше.</div>
  {:else}
    <div class="space-y-3">
      {#each plans as plan (plan.id)}
        <details class="admin-card">
          <summary class="admin-summary">
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">{plan.name}</span>
              <span class="mt-1 block text-xs text-[color:var(--color-muted)]">
                {plan.durationDays} дней · {plan.priceStars} ⭐ · порядок
                {plan.sortOrder}
              </span>
            </span>
            <span class:status-active={plan.isActive} class="status-pill">
              {plan.isActive ? "Активен" : "Выключен"}
            </span>
          </summary>

          <div class="border-t border-[color:var(--color-border)] p-4">
            <form
              method="POST"
              action="?/updatePlan"
              class="admin-form-grid"
              use:enhance={enhanceForm}
            >
              <input name="id" type="hidden" value={plan.id} />
              <label>
                <span>Название</span>
                <input
                  class="admin-input"
                  name="name"
                  value={plan.name}
                  required
                  maxlength="120"
                />
              </label>
              <label>
                <span>Срок, дней</span>
                <input
                  class="admin-input"
                  name="durationDays"
                  type="number"
                  value={plan.durationDays}
                  required
                  min="1"
                  max="365"
                />
              </label>
              <label>
                <span>Цена, Stars</span>
                <input
                  class="admin-input"
                  name="priceStars"
                  type="number"
                  value={plan.priceStars}
                  required
                  min="1"
                />
              </label>
              <label>
                <span>Порядок</span>
                <input
                  class="admin-input"
                  name="sortOrder"
                  type="number"
                  value={plan.sortOrder}
                  required
                />
              </label>
              <label class="sm:col-span-2">
                <span>Описание</span>
                <textarea
                  class="admin-input resize-y"
                  name="description"
                  rows="3"
                  maxlength="500">{plan.description ?? ""}</textarea
                >
              </label>
              <div class="flex flex-wrap gap-4 sm:col-span-2">
                <label class="admin-checkbox">
                  <input
                    name="isActive"
                    type="checkbox"
                    checked={plan.isActive}
                  />
                  Активен
                </label>
                <label class="admin-checkbox">
                  <input
                    name="isFeatured"
                    type="checkbox"
                    checked={plan.isFeatured}
                  />
                  Рекомендуемый
                </label>
              </div>
              <button
                class="admin-primary sm:col-span-2"
                type="submit"
                data-key={`plan-update-${plan.id}`}
                disabled={submittingKey !== null}
              >
                {submittingKey === `plan-update-${plan.id}`
                  ? "Сохраняем…"
                  : "Сохранить изменения"}
              </button>
            </form>

            <div class="mt-3 grid grid-cols-2 gap-2">
              <form
                method="POST"
                action="?/deactivatePlan"
                use:enhance={enhanceForm}
              >
                <input name="id" type="hidden" value={plan.id} />
                <button
                  class="admin-secondary w-full"
                  type="submit"
                  data-key={`plan-deactivate-${plan.id}`}
                  disabled={!plan.isActive || submittingKey !== null}
                >
                  Деактивировать
                </button>
              </form>
              <form
                method="POST"
                action="?/deletePlan"
                use:enhance={enhanceForm}
              >
                <input name="id" type="hidden" value={plan.id} />
                <button
                  class="admin-danger w-full"
                  type="submit"
                  data-key={`plan-delete-${plan.id}`}
                  disabled={submittingKey !== null}
                >
                  Удалить
                </button>
              </form>
            </div>
          </div>
        </details>
      {/each}
    </div>
  {/if}
</section>
