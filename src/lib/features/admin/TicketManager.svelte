<script lang="ts">
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import type { SubmitFunction } from "@sveltejs/kit";

  import type { AdminTicket } from "./types";

  let {
    selectedStatus,
    tickets,
  }: {
    selectedStatus: "all" | "in_progress" | "new" | "resolved";
    tickets: AdminTicket[];
  } = $props();

  let submittingKey = $state<string | null>(null);

  const filters = [
    { id: "all", label: "Все" },
    { id: "new", label: "Новые" },
    { id: "in_progress", label: "В работе" },
    { id: "resolved", label: "Решены" },
  ] as const;

  const enhanceForm: SubmitFunction = ({ submitter }) => {
    submittingKey = submitter?.dataset.key ?? "ticket";

    return async ({ update }) => {
      await update({ reset: false });
      submittingKey = null;
    };
  };

  function formatDate(date: Date): string {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date);
  }

  function statusLabel(status: AdminTicket["status"]): string {
    if (status === "new") return "Новое";
    if (status === "in_progress") return "В работе";
    return "Решено";
  }
</script>

<section aria-labelledby="admin-tickets-heading">
  <div class="mb-4 flex items-end justify-between gap-4">
    <div>
      <p class="admin-eyebrow">Обращения</p>
      <h2 id="admin-tickets-heading" class="text-2xl font-semibold">
        Поддержка
      </h2>
    </div>
    <span class="admin-count">{tickets.length}</span>
  </div>

  <nav
    class="mb-4 flex gap-2 overflow-x-auto pb-1"
    aria-label="Статус обращений"
  >
    {#each filters as filter (filter.id)}
      <form method="GET" action={resolve("/admin")}>
        <input name="view" type="hidden" value="tickets" />
        {#if filter.id !== "all"}
          <input name="ticketStatus" type="hidden" value={filter.id} />
        {/if}
        <button
          class:admin-filter-active={selectedStatus === filter.id}
          class="admin-filter"
          type="submit"
        >
          {filter.label}
        </button>
      </form>
    {/each}
  </nav>

  {#if tickets.length === 0}
    <div class="admin-empty">Обращений с таким статусом нет.</div>
  {:else}
    <div class="space-y-3">
      {#each tickets as ticket (ticket.id)}
        <article class="admin-card p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="font-semibold">{ticket.publicNumber}</p>
              <p class="mt-1 text-xs text-[color:var(--color-muted)]">
                {formatDate(ticket.createdAt)} UTC · Telegram {ticket.telegramUserId}
              </p>
            </div>
            <span
              class:status-active={ticket.status !== "resolved"}
              class="status-pill"
            >
              {statusLabel(ticket.status)}
            </span>
          </div>

          <div
            class="mt-4 rounded-[16px] bg-[color:var(--color-card-raised)] p-3"
          >
            <p class="font-medium">{ticket.subject}</p>
            <p
              class="mt-2 text-sm leading-6 whitespace-pre-wrap text-[color:var(--color-muted)]"
            >
              {ticket.message}
            </p>
          </div>

          <div
            class="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--color-muted)]"
          >
            <span>
              {[ticket.firstName, ticket.lastName].filter(Boolean).join(" ")}
              {ticket.username ? ` · @${ticket.username}` : ""}
            </span>
            <span
              class:text-[color:var(--color-accent)]={ticket.telegramDeliveryStatus ===
                "sent"}
              class:text-red-400={ticket.telegramDeliveryStatus === "failed"}
            >
              Telegram:
              {ticket.telegramDeliveryStatus === "sent"
                ? "доставлено"
                : ticket.telegramDeliveryStatus === "failed"
                  ? "ошибка"
                  : "ожидает"}
            </span>
          </div>

          <form
            method="POST"
            action="?/updateTicketStatus"
            class="mt-4 flex gap-2"
            use:enhance={enhanceForm}
          >
            <input name="id" type="hidden" value={ticket.id} />
            <label class="sr-only" for={`ticket-status-${ticket.id}`}>
              Статус обращения
            </label>
            <select
              id={`ticket-status-${ticket.id}`}
              class="admin-input min-w-0 flex-1"
              name="status"
              value={ticket.status}
              disabled={submittingKey !== null}
            >
              <option value="new">Новое</option>
              <option value="in_progress">В работе</option>
              <option value="resolved">Решено</option>
            </select>
            <button
              class="admin-primary shrink-0"
              type="submit"
              data-key={`ticket-${ticket.id}`}
              disabled={submittingKey !== null}
            >
              {submittingKey === `ticket-${ticket.id}` ? "…" : "Сохранить"}
            </button>
          </form>
        </article>
      {/each}
    </div>
  {/if}
</section>
