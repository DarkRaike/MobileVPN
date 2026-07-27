<script lang="ts">
  import type { AdminAuditRecord } from "./types";

  let { records }: { records: AdminAuditRecord[] } = $props();

  function formatDate(date: Date): string {
    return new Intl.DateTimeFormat("ru-RU", {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "UTC",
    }).format(date);
  }

  function prettyJson(value: string | null): string {
    if (!value) {
      return "—";
    }

    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return "Некорректный snapshot";
    }
  }
</script>

<section aria-labelledby="admin-audit-heading">
  <div class="mb-4 flex items-end justify-between gap-4">
    <div>
      <p class="admin-eyebrow">Безопасность</p>
      <h2 id="admin-audit-heading" class="text-2xl font-semibold">
        Журнал действий
      </h2>
    </div>
    <span class="admin-count">{records.length}</span>
  </div>

  {#if records.length === 0}
    <div class="admin-empty">Административных действий пока нет.</div>
  {:else}
    <div class="space-y-3">
      {#each records as record (record.id)}
        <details class="admin-card">
          <summary class="admin-summary">
            <span class="min-w-0 flex-1">
              <span class="block truncate font-semibold">{record.action}</span>
              <span class="mt-1 block text-xs text-[color:var(--color-muted)]">
                {record.entityType} · {record.entityId}
              </span>
            </span>
            <time
              class="shrink-0 text-right text-xs text-[color:var(--color-muted)]"
              datetime={record.createdAt.toISOString()}
            >
              {formatDate(record.createdAt)} UTC
            </time>
          </summary>
          <div
            class="grid gap-3 border-t border-[color:var(--color-border)] p-4 lg:grid-cols-2"
          >
            <div>
              <p
                class="mb-2 text-xs font-semibold text-[color:var(--color-muted)] uppercase"
              >
                До
              </p>
              <pre class="admin-json">{prettyJson(record.beforeJson)}</pre>
            </div>
            <div>
              <p
                class="mb-2 text-xs font-semibold text-[color:var(--color-muted)] uppercase"
              >
                После
              </p>
              <pre class="admin-json">{prettyJson(record.afterJson)}</pre>
            </div>
          </div>
        </details>
      {/each}
    </div>
  {/if}
</section>
