<script lang="ts">
  import { enhance } from "$app/forms";
  import type { SubmitFunction } from "@sveltejs/kit";

  let {
    adminTelegramUserId,
    grants,
  }: {
    adminTelegramUserId: string;
    grants: Array<{
      createdAt: Date;
      id: string;
      planName: string;
      provisioningStatus: string;
      status: string;
      telegramUserId: string;
    }>;
  } = $props();

  let submitting = $state(false);
  let targetTelegramUserId = $state("");
  let durationDays = $state(30);

  const enhanceForm: SubmitFunction = () => {
    submitting = true;

    return async ({ update }) => {
      await update({ reset: false });
      submitting = false;
    };
  };

  function fillSelf(): void {
    targetTelegramUserId = adminTelegramUserId;
  }

  function formatDate(value: Date): string {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
    }).format(new Date(value));
  }
</script>

<section aria-labelledby="admin-access-heading">
  <div class="mb-4 flex items-end justify-between gap-4">
    <div>
      <p class="admin-eyebrow">Подписки</p>
      <h2 id="admin-access-heading" class="text-2xl font-semibold">
        Выдача доступа
      </h2>
    </div>
    <span class="admin-count">{grants.length}</span>
  </div>

  <form
    method="POST"
    action="?/grantAccess"
    class="admin-card admin-form-grid p-4"
    use:enhance={enhanceForm}
  >
    <label>
      <span>Telegram ID пользователя</span>
      <input
        class="admin-input"
        name="targetTelegramUserId"
        bind:value={targetTelegramUserId}
        required
        inputmode="numeric"
        pattern="[0-9]&#123;1,20&#125;"
        placeholder="123456789"
      />
    </label>
    <label>
      <span>Срок, дней</span>
      <input
        class="admin-input"
        name="durationDays"
        bind:value={durationDays}
        required
        type="number"
        min="1"
        max="365"
      />
    </label>
    <div class="flex flex-wrap items-center gap-2 sm:col-span-2">
      <button class="admin-primary" type="submit" disabled={submitting}>
        {submitting ? "Выдаём…" : "Выдать доступ"}
      </button>
      <button class="admin-secondary" type="button" onclick={fillSelf}>
        Себе
      </button>
      <p class="m-0 text-xs text-[color:var(--color-muted)]">
        Оплата не создаётся. Срок продлевает текущую подписку, максимум 365
        дней.
      </p>
    </div>
  </form>

  <div class="mt-4">
    {#if grants.length === 0}
      <p class="admin-empty">Выдач ещё не было.</p>
    {:else}
      <ul class="flex flex-col gap-2">
        {#each grants as grant (grant.id)}
          <li class="admin-card p-4">
            <div class="flex flex-wrap items-baseline justify-between gap-2">
              <span class="font-medium">Telegram {grant.telegramUserId}</span>
              <span class="text-xs text-[color:var(--color-muted)]">
                {formatDate(grant.createdAt)}
              </span>
            </div>
            <p class="mt-1 mb-0 text-xs text-[color:var(--color-muted)]">
              {grant.status} · выдача {grant.provisioningStatus}
            </p>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
