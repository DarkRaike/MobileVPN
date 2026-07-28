<script lang="ts">
  import AuthGate from "$lib/features/auth/AuthGate.svelte";
  import AppShell from "$lib/features/navigation/AppShell.svelte";
  import ThemeBridge from "$lib/telegram/ThemeBridge.svelte";
  import type { AppActionFeedback } from "$lib/features/catalog/types";

  import type { PageProps } from "./$types";

  let { data, form }: PageProps = $props();

  const feedback = $derived((form ?? null) as AppActionFeedback | null);
</script>

<svelte:head>
  <title>VPN</title>
  <meta
    name="description"
    content="Telegram Mini App для управления VPN-подпиской"
  />
</svelte:head>

<ThemeBridge />

<AppShell
  activePlans={data.activePlans}
  faqItems={data.faqItems}
  {feedback}
  isAdmin={data.isAdmin}
  profileOverview={data.profileOverview}
  purchasesEnabled={data.purchasesEnabled}
  sessionExpiresAt={data.sessionExpiresAt}
  user={data.user}
/>

{#if !data.user}
  <AuthGate
    developmentMockAuthEnabled={data.developmentMockAuthEnabled}
    overlay
  />
{/if}
