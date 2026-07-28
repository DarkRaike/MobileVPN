<script lang="ts">
  import { resolve } from "$app/paths";
  import { onMount } from "svelte";

  import AppIcon from "$lib/components/AppIcon.svelte";
  import AuditLog from "$lib/features/admin/AuditLog.svelte";
  import FaqManager from "$lib/features/admin/FaqManager.svelte";
  import OrderManager from "$lib/features/admin/OrderManager.svelte";
  import PlanManager from "$lib/features/admin/PlanManager.svelte";
  import PromoManager from "$lib/features/admin/PromoManager.svelte";
  import TicketManager from "$lib/features/admin/TicketManager.svelte";
  import type {
    AdminActionFeedback,
    AdminAuditRecord,
    AdminFaq,
    AdminOrder,
    AdminPlan,
    AdminPromoCode,
    AdminTicket,
  } from "$lib/features/admin/types";

  import type { PageProps } from "./$types";

  type AdminSection =
    "audit" | "catalog" | "faq" | "orders" | "promos" | "tickets";

  let { data, form }: PageProps = $props();
  let activeSection = $state<AdminSection>("catalog");

  onMount(() => {
    const view = new URL(window.location.href).searchParams.get("view");

    if (view === "tickets") {
      activeSection = "tickets";
    }
  });

  const feedback = $derived((form ?? null) as AdminActionFeedback | null);
  const sections: Array<{
    id: AdminSection;
    label: string;
  }> = [
    { id: "catalog", label: "Тарифы" },
    { id: "orders", label: "Заказы" },
    { id: "promos", label: "Промокоды" },
    { id: "faq", label: "FAQ" },
    { id: "tickets", label: "Обращения" },
    { id: "audit", label: "Аудит" },
  ];
</script>

<svelte:head>
  <title>Администрирование · VPN</title>
  <meta name="description" content="Защищённый административный раздел VPN" />
</svelte:head>

<main class="admin-page">
  <div class="admin-container">
    <header class="mb-5 flex items-center justify-between gap-4">
      <div class="min-w-0">
        <p class="admin-eyebrow">VPN</p>
        <h1 class="truncate text-[28px] font-semibold tracking-[-0.03em]">
          Администрирование
        </h1>
        <p class="mt-1 truncate text-sm text-[color:var(--color-muted)]">
          {data.admin.firstName} · Telegram {data.admin.telegramUserId}
        </p>
      </div>
      <a
        class="header-pill grid min-h-12 min-w-12 place-items-center rounded-[18px] text-[color:var(--color-accent)]"
        href={resolve("/")}
        aria-label="Вернуться в Mini App"
      >
        <AppIcon name="home" size={22} />
      </a>
    </header>

    <nav class="admin-tabs" aria-label="Разделы администрирования">
      {#each sections as section (section.id)}
        <button
          class:admin-tab-active={activeSection === section.id}
          class="admin-tab"
          type="button"
          aria-current={activeSection === section.id ? "page" : undefined}
          onclick={() => (activeSection = section.id)}
        >
          {section.label}
        </button>
      {/each}
    </nav>

    {#if feedback?.message}
      <div
        class:feedback-error={!feedback.ok}
        class:feedback-success={feedback.ok}
        class="mb-5 rounded-[18px] px-4 py-3 text-sm"
        role={feedback.ok ? "status" : "alert"}
      >
        {feedback.message}
        {#if feedback.code && !feedback.ok}
          <span class="mt-1 block text-xs opacity-70">
            Код: {feedback.code}
          </span>
        {/if}
      </div>
    {/if}

    <div class="admin-content">
      {#if activeSection === "catalog"}
        <PlanManager plans={data.catalog.plans as AdminPlan[]} />
      {:else if activeSection === "orders"}
        <OrderManager orders={data.orders as AdminOrder[]} />
      {:else if activeSection === "promos"}
        <PromoManager
          plans={data.catalog.plans as AdminPlan[]}
          promoCodes={data.catalog.promoCodes as AdminPromoCode[]}
        />
      {:else if activeSection === "faq"}
        <FaqManager faqItems={data.catalog.faqItems as AdminFaq[]} />
      {:else if activeSection === "tickets"}
        <TicketManager
          selectedStatus={data.ticketStatus as
            "all" | "in_progress" | "new" | "resolved"}
          tickets={data.tickets as AdminTicket[]}
        />
      {:else}
        <AuditLog records={data.auditLog as AdminAuditRecord[]} />
      {/if}
    </div>
  </div>
</main>
