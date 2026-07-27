<script lang="ts">
  import { enhance } from "$app/forms";
  import type { SubmitFunction } from "@sveltejs/kit";

  import type { AdminPlan, AdminPromoCode } from "./types";

  let {
    plans,
    promoCodes,
  }: {
    plans: AdminPlan[];
    promoCodes: AdminPromoCode[];
  } = $props();

  let submittingKey = $state<string | null>(null);

  const enhanceForm: SubmitFunction = ({ formElement, submitter }) => {
    submittingKey = submitter?.dataset.key ?? "promo";

    return async ({ result, update }) => {
      await update({
        reset:
          result.type === "success" && formElement.dataset.reset === "true",
      });
      submittingKey = null;
    };
  };

  function toDateTimeLocal(date: Date | null): string {
    return date ? date.toISOString().slice(0, 16) : "";
  }
</script>

<section aria-labelledby="admin-promos-heading">
  <div class="mb-4 flex items-end justify-between gap-4">
    <div>
      <p class="admin-eyebrow">Скидки</p>
      <h2 id="admin-promos-heading" class="text-2xl font-semibold">
        Промокоды
      </h2>
    </div>
    <span class="admin-count">{promoCodes.length}</span>
  </div>

  <details class="admin-card mb-4">
    <summary class="admin-summary">Новый промокод</summary>
    <form
      method="POST"
      action="?/createPromo"
      class="admin-form-grid border-t border-[color:var(--color-border)] p-4"
      data-reset="true"
      use:enhance={enhanceForm}
    >
      <label>
        <span>Код</span>
        <input
          class="admin-input uppercase"
          name="code"
          required
          minlength="3"
          maxlength="32"
          pattern="[A-Za-z0-9_-]+"
        />
      </label>
      <label>
        <span>Тип скидки</span>
        <select class="admin-input" name="discountType">
          <option value="percent">Процент</option>
          <option value="fixed">Stars</option>
        </select>
      </label>
      <label>
        <span>Размер скидки</span>
        <input
          class="admin-input"
          name="discountValue"
          type="number"
          required
          min="1"
        />
      </label>
      <label>
        <span>Общий лимит</span>
        <input class="admin-input" name="maxUses" type="number" min="1" />
      </label>
      <label>
        <span>Лимит на пользователя</span>
        <input
          class="admin-input"
          name="maxUsesPerUser"
          type="number"
          min="1"
        />
      </label>
      <label>
        <span>Начало, UTC</span>
        <input class="admin-input" name="startsAt" type="datetime-local" />
      </label>
      <label>
        <span>Окончание, UTC</span>
        <input class="admin-input" name="endsAt" type="datetime-local" />
      </label>
      <label class="admin-checkbox self-end pb-3">
        <input name="isActive" type="checkbox" checked />
        Активен
      </label>

      <fieldset class="sm:col-span-2">
        <legend class="mb-2 text-xs text-[color:var(--color-muted)]">
          Разрешённые тарифы · пусто означает все
        </legend>
        <div class="flex flex-wrap gap-3">
          {#each plans as plan (plan.id)}
            <label class="admin-checkbox">
              <input name="allowedPlanIds" type="checkbox" value={plan.id} />
              {plan.name}
            </label>
          {/each}
        </div>
      </fieldset>

      <button
        class="admin-primary sm:col-span-2"
        type="submit"
        data-key="promo-create"
        disabled={submittingKey !== null}
      >
        {submittingKey === "promo-create" ? "Сохраняем…" : "Создать промокод"}
      </button>
    </form>
  </details>

  {#if promoCodes.length === 0}
    <div class="admin-empty">Промокодов пока нет.</div>
  {:else}
    <div class="space-y-3">
      {#each promoCodes as promo (promo.id)}
        <details class="admin-card">
          <summary class="admin-summary">
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">
                {promo.codeNormalized}
              </span>
              <span class="mt-1 block text-xs text-[color:var(--color-muted)]">
                {promo.discountType === "percent"
                  ? `${promo.discountValue}%`
                  : `${promo.discountValue} Stars`}
              </span>
            </span>
            <span class:status-active={promo.isActive} class="status-pill">
              {promo.isActive ? "Активен" : "Выключен"}
            </span>
          </summary>

          <div class="border-t border-[color:var(--color-border)] p-4">
            <form
              method="POST"
              action="?/updatePromo"
              class="admin-form-grid"
              use:enhance={enhanceForm}
            >
              <input name="id" type="hidden" value={promo.id} />
              <label>
                <span>Код</span>
                <input
                  class="admin-input uppercase"
                  name="code"
                  value={promo.codeNormalized}
                  required
                  minlength="3"
                  maxlength="32"
                  pattern="[A-Za-z0-9_-]+"
                />
              </label>
              <label>
                <span>Тип скидки</span>
                <select
                  class="admin-input"
                  name="discountType"
                  value={promo.discountType}
                >
                  <option value="percent">Процент</option>
                  <option value="fixed">Stars</option>
                </select>
              </label>
              <label>
                <span>Размер скидки</span>
                <input
                  class="admin-input"
                  name="discountValue"
                  type="number"
                  value={promo.discountValue}
                  required
                  min="1"
                />
              </label>
              <label>
                <span>Общий лимит</span>
                <input
                  class="admin-input"
                  name="maxUses"
                  type="number"
                  value={promo.maxUses ?? ""}
                  min="1"
                />
              </label>
              <label>
                <span>Лимит на пользователя</span>
                <input
                  class="admin-input"
                  name="maxUsesPerUser"
                  type="number"
                  value={promo.maxUsesPerUser ?? ""}
                  min="1"
                />
              </label>
              <label>
                <span>Начало, UTC</span>
                <input
                  class="admin-input"
                  name="startsAt"
                  type="datetime-local"
                  value={toDateTimeLocal(promo.startsAt)}
                />
              </label>
              <label>
                <span>Окончание, UTC</span>
                <input
                  class="admin-input"
                  name="endsAt"
                  type="datetime-local"
                  value={toDateTimeLocal(promo.endsAt)}
                />
              </label>
              <label class="admin-checkbox self-end pb-3">
                <input
                  name="isActive"
                  type="checkbox"
                  checked={promo.isActive}
                />
                Активен
              </label>

              <fieldset class="sm:col-span-2">
                <legend class="mb-2 text-xs text-[color:var(--color-muted)]">
                  Разрешённые тарифы · пусто означает все
                </legend>
                <div class="flex flex-wrap gap-3">
                  {#each plans as plan (plan.id)}
                    <label class="admin-checkbox">
                      <input
                        name="allowedPlanIds"
                        type="checkbox"
                        value={plan.id}
                        checked={promo.allowedPlanIds.includes(plan.id)}
                      />
                      {plan.name}
                    </label>
                  {/each}
                </div>
              </fieldset>

              <button
                class="admin-primary sm:col-span-2"
                type="submit"
                data-key={`promo-update-${promo.id}`}
                disabled={submittingKey !== null}
              >
                {submittingKey === `promo-update-${promo.id}`
                  ? "Сохраняем…"
                  : "Сохранить изменения"}
              </button>
            </form>

            <div class="mt-3 grid grid-cols-2 gap-2">
              <form
                method="POST"
                action="?/deactivatePromo"
                use:enhance={enhanceForm}
              >
                <input name="id" type="hidden" value={promo.id} />
                <button
                  class="admin-secondary w-full"
                  type="submit"
                  data-key={`promo-deactivate-${promo.id}`}
                  disabled={!promo.isActive || submittingKey !== null}
                >
                  Деактивировать
                </button>
              </form>
              <form
                method="POST"
                action="?/deletePromo"
                use:enhance={enhanceForm}
              >
                <input name="id" type="hidden" value={promo.id} />
                <button
                  class="admin-danger w-full"
                  type="submit"
                  data-key={`promo-delete-${promo.id}`}
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
