<script lang="ts">
  import AuthGate from "$lib/features/auth/AuthGate.svelte";
  import AppShell from "$lib/features/navigation/AppShell.svelte";
  import ThemeBridge from "$lib/telegram/ThemeBridge.svelte";

  import type { PageProps } from "./$types";

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>Astra VPN</title>
  <meta
    name="description"
    content="Telegram Mini App для управления подпиской Astra VPN"
  />
</svelte:head>

<ThemeBridge />

{#if data.user}
  <AppShell sessionExpiresAt={data.sessionExpiresAt} user={data.user} />
{:else}
  <AuthGate developmentMockAuthEnabled={data.developmentMockAuthEnabled} />
{/if}
